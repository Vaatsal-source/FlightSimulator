import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial, type BufferGeometry, type Material, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CARRIER_DECK, CARRIER_SHIP } from '../../config/carrier'

/** The ship drawn beyond this distance is not worth its triangles (the sea haze has swallowed it long before). */
const DRAW_DISTANCE = 45000

/**
 * The aircraft carrier: a king-sized ship at anchor (Sketchfab "Gerald R Ford aircraft Carrier" by waelXcm, CC-BY-4.0, baked by
 * scripts/prepare-carrier.mjs), with the landing deck's centreline and edge lights drawn on top of it. The deck itself is solid
 * ground for the physics (terrainSampler) and a runway for the guidance (config/airports).
 */
export function Carrier() {
  const camera = useThree((s) => s.camera)

  const { root, disposables } = useMemo(() => {
    const root = new Group()
    root.name = 'carrier'
    root.position.set(CARRIER_SHIP.x, 0, CARRIER_SHIP.z)
    root.rotation.y = CARRIER_SHIP.rotationY

    // Deck markings and lights, in the deck's own frame (z along it, toward the bow).
    const deck = new Group()
    deck.position.set(CARRIER_DECK.shipX, CARRIER_DECK.height, CARRIER_DECK.shipZ)
    root.add(deck)
    const disposables: { dispose(): void }[] = []
    const dash = new BoxGeometry(0.7, 0.04, 12)
    const bar = new BoxGeometry(14, 0.04, 1.2)
    const lamp = new BoxGeometry(0.6, 0.5, 0.6)
    const white = new MeshBasicMaterial({ color: 0xf2f2f2, toneMapped: false })
    const green = new MeshBasicMaterial({ color: 0x35ff6b, toneMapped: false, fog: false })
    const red = new MeshBasicMaterial({ color: 0xff3b30, toneMapped: false, fog: false })
    const amber = new MeshBasicMaterial({ color: 0xffc04a, toneMapped: false, fog: false })
    disposables.push(dash, bar, lamp, white, green, red, amber)

    const half = CARRIER_DECK.length / 2
    const place = (geo: BufferGeometry, mat: Material, spots: [number, number, number][]): void => {
      const m = new InstancedMesh(geo, mat, spots.length)
      const t = new Matrix4()
      spots.forEach(([x, y, z], i) => m.setMatrixAt(i, t.makeTranslation(x, y, z)))
      m.frustumCulled = false
      deck.add(m)
    }
    // Centreline dashes, and a bar across the deck at each end of the landing area.
    const dashes: [number, number, number][] = []
    for (let z = -half + 30; z < half - 20; z += 26) dashes.push([0, 0.06, z])
    place(dash, white, dashes)
    place(bar, white, [[0, 0.06, -half + 8], [0, 0.06, half - 8]])
    // Edge lights: green on the starboard side, red on the port side (the bow is +z, port is +x), amber across the stern.
    const w = CARRIER_DECK.width / 2 - 1
    const edge = (sign: number) => {
      const spots: [number, number, number][] = []
      for (let z = -half; z <= half; z += 24) spots.push([sign * w, 0.3, z])
      return spots
    }
    place(lamp, red, edge(1))
    place(lamp, green, edge(-1))
    const sternLights: [number, number, number][] = []
    for (let x = -w; x <= w; x += 8) sternLights.push([x, 0.3, -half])
    place(lamp, amber, sternLights)
    return { root, disposables }
  }, [])

  useEffect(() => {
    let cancelled = false
    let model: Group | null = null
    new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/carrier/carrier.glb`)
      .then((gltf) => {
        if (cancelled) return
        model = gltf.scene
        model.traverse((o) => {
          const mesh = o as Mesh
          if (mesh.isMesh) mesh.frustumCulled = true
        })
        root.add(model)
      })
      .catch((err) => console.warn('The aircraft carrier model failed to load', err))
    return () => {
      cancelled = true
      if (model) {
        root.remove(model)
        model.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          mesh.geometry.dispose()
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            const mat = m as Material & { map?: { dispose(): void } | null }
            mat.map?.dispose()
            mat.dispose()
          }
        })
      }
    }
  }, [root])

  useEffect(
    () => () => {
      for (const d of disposables) d.dispose()
    },
    [disposables],
  )

  // The ship is a long way from most of the world: only draw it when the camera is within sight of it.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const dx = camera.position.x - CARRIER_SHIP.x
      const dz = camera.position.z - CARRIER_SHIP.z
      root.visible = dx * dx + dz * dz < DRAW_DISTANCE * DRAW_DISTANCE
      raf = window.setTimeout(tick, 500) as unknown as number
    }
    tick()
    return () => window.clearTimeout(raf)
  }, [camera, root])

  return <primitive object={root} />
}
