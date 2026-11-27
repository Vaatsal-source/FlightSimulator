"""Generate a low-poly, F-16-inspired fictional fighter cockpit for browser games.

Output: f16_inspired_cockpit.glb
Units: meters. Coordinate system: X = left/right, Y = forward, Z = up.
The model is a standalone cockpit tub/interior, not an aircraft exterior.
"""
from __future__ import annotations
import math
from pathlib import Path
import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

OUT = Path('/mnt/data/f16_inspired_cockpit.glb')
scene = trimesh.Scene()
_counter = 0

# Muted military cockpit palette. All are PBR materials supported by glTF 2.0.
MATS = {
    'tub': PBRMaterial(name='Cockpit | dark grey-green composite', baseColorFactor=[48, 57, 52, 255], metallicFactor=0.18, roughnessFactor=0.82),
    'panel': PBRMaterial(name='Instrument panel | charcoal', baseColorFactor=[24, 29, 30, 255], metallicFactor=0.22, roughnessFactor=0.7),
    'rubber': PBRMaterial(name='Rubber', baseColorFactor=[12, 15, 15, 255], metallicFactor=0.02, roughnessFactor=0.96),
    'metal': PBRMaterial(name='Anodized metal', baseColorFactor=[105, 112, 110, 255], metallicFactor=0.78, roughnessFactor=0.32),
    'darkmetal': PBRMaterial(name='Dark metal', baseColorFactor=[35, 42, 43, 255], metallicFactor=0.72, roughnessFactor=0.42),
    'seat': PBRMaterial(name='Seat upholstery', baseColorFactor=[43, 53, 49, 255], metallicFactor=0.0, roughnessFactor=0.98),
    'fabric': PBRMaterial(name='Harness webbing', baseColorFactor=[125, 105, 55, 255], metallicFactor=0.0, roughnessFactor=0.95),
    'red': PBRMaterial(name='Ejection warning red', baseColorFactor=[180, 24, 20, 255], metallicFactor=0.0, roughnessFactor=0.56),
    'yellow': PBRMaterial(name='Safety yellow', baseColorFactor=[218, 166, 30, 255], metallicFactor=0.08, roughnessFactor=0.62),
    'screen': PBRMaterial(name='Display glass | dark', baseColorFactor=[4, 15, 13, 255], emissiveFactor=[0.005, 0.018, 0.014], metallicFactor=0.12, roughnessFactor=0.24),
    'green': PBRMaterial(name='Phosphor green', baseColorFactor=[80, 255, 170, 255], emissiveFactor=[0.12, 0.8, 0.36], metallicFactor=0.0, roughnessFactor=0.35),
    'cyan': PBRMaterial(name='HUD cyan-green', baseColorFactor=[105, 240, 215, 255], emissiveFactor=[0.08, 0.62, 0.46], metallicFactor=0.0, roughnessFactor=0.25),
    'white': PBRMaterial(name='Off-white markings', baseColorFactor=[190, 196, 177, 255], metallicFactor=0.0, roughnessFactor=0.7),
    'glass': PBRMaterial(name='HUD combiner glass', baseColorFactor=[100, 150, 145, 80], metallicFactor=0.0, roughnessFactor=0.08, alphaMode='BLEND', doubleSided=True),
}


def add(mesh: trimesh.Trimesh, name: str, mat: str):
    global _counter
    _counter += 1
    mesh.visual.material = MATS[mat]
    mesh.metadata['name'] = name
    scene.add_geometry(mesh, geom_name=f'{name}_{_counter:03d}', node_name=f'{name}_{_counter:03d}')
    return mesh


def box(name, center, dims, mat='panel', axes=None):
    m = trimesh.creation.box(extents=dims)
    if axes is None:
        m.apply_translation(center)
    else:
        u, v, n = [np.asarray(a, dtype=float) for a in axes]
        T = np.eye(4)
        T[:3, 0], T[:3, 1], T[:3, 2] = u, v, n
        T[:3, 3] = center
        m.apply_transform(T)
    return add(m, name, mat)


def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / (n if n else 1.0)


def cylinder(name, start, end, radius, mat='metal', sections=16):
    a, b = np.asarray(start, float), np.asarray(end, float)
    d = b - a
    length = float(np.linalg.norm(d))
    if length < 1e-8:
        return None
    m = trimesh.creation.cylinder(radius=radius, height=length, sections=sections)
    z = unit(d)
    x = unit(np.cross([0, 1, 0] if abs(z[1]) < 0.92 else [1, 0, 0], z))
    y = unit(np.cross(z, x))
    T = np.eye(4)
    T[:3, :3] = np.column_stack((x, y, z))
    T[:3, 3] = (a + b) / 2
    m.apply_transform(T)
    return add(m, name, mat)


def sphere(name, center, radius, mat='metal', subdivisions=1, scale=None):
    m = trimesh.creation.icosphere(subdivisions=subdivisions, radius=radius)
    if scale is not None:
        m.apply_scale(scale)
    m.apply_translation(center)
    return add(m, name, mat)


def torus(name, center, major_r, minor_r, axes, mat='metal', seg_major=32, seg_minor=8):
    u, v, n = [unit(a) for a in axes]
    c = np.asarray(center, float)
    verts, faces = [], []
    for i in range(seg_major):
        a = 2 * math.pi * i / seg_major
        radial = math.cos(a) * u + math.sin(a) * v
        for j in range(seg_minor):
            b = 2 * math.pi * j / seg_minor
            p = c + (major_r + minor_r * math.cos(b)) * radial + minor_r * math.sin(b) * n
            verts.append(p)
    for i in range(seg_major):
        for j in range(seg_minor):
            a = i * seg_minor + j
            b = ((i + 1) % seg_major) * seg_minor + j
            c1 = ((i + 1) % seg_major) * seg_minor + (j + 1) % seg_minor
            d = i * seg_minor + (j + 1) % seg_minor
            faces.extend([[a, b, d], [b, c1, d]])
    return add(trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=False), name, mat)


def tube_path(name, pts, radius, mat='metal', sections=10):
    for i in range(len(pts)-1):
        cylinder(f'{name}_{i}', pts[i], pts[i+1], radius, mat, sections)

# Cockpit coordinate system: pilot sits at y=-0.9 and looks toward +Y.
# Tub / floor / structural side shells.
box('Cockpit floor pan', (0, 0.05, -0.055), (1.34, 2.82, 0.13), 'tub')
box('Front footwell bulkhead', (0, 1.18, 0.28), (1.27, 0.14, 0.58), 'tub')
box('Rear bulkhead', (0, -1.25, 0.48), (1.32, 0.16, 1.03), 'tub')
for s, side in [(-1, 'Left'), (1, 'Right')]:
    # Tapered-looking side shells built from overlapping angled sections.
    box(f'{side} cockpit lower sidewall', (s*0.625, -0.02, 0.43), (0.14, 2.48, 0.86), 'tub')
    box(f'{side} cockpit upper sill', (s*0.66, -0.01, 0.92), (0.18, 2.52, 0.12), 'darkmetal')
    box(f'{side} canopy rail', (s*0.66, -0.12, 1.02), (0.10, 2.48, 0.10), 'metal')
    # Sidewall ribs and access covers.
    for j, yy in enumerate([-0.92, -0.36, 0.22, 0.76]):
        box(f'{side} sidewall rib {j}', (s*0.557, yy, 0.52), (0.035, 0.055, 0.70), 'darkmetal')
    for j, yy in enumerate([-0.78, -0.22, 0.36]):
        box(f'{side} sidewall access panel {j}', (s*0.545, yy, 0.67), (0.025, 0.35, 0.24), 'panel')
        for k in range(3):
            sphere(f'{side} access screw {j}-{k}', (s*0.526, yy-0.12+k*0.12, 0.67), 0.009, 'metal', 1)

# Pilot seat assembly, set low in the tub.
box('Seat base frame', (0, -0.84, 0.18), (0.59, 0.68, 0.16), 'darkmetal')
box('Seat cushion', (0, -0.80, 0.32), (0.53, 0.60, 0.20), 'seat')
# Seat back is slightly reclined; orient its long axis in the Y/Z plane.
seat_axis_u = np.array([1, 0, 0.0])
seat_axis_v = unit([0, -0.32, 0.95])
seat_axis_n = unit(np.cross(seat_axis_u, seat_axis_v))
box('Seat back cushion', (0, -1.03, 0.88), (0.54, 1.05, 0.20), 'seat', (seat_axis_u, seat_axis_v, seat_axis_n))
box('Seat headrest', (0, -1.18, 1.35), (0.40, 0.25, 0.17), 'seat', (seat_axis_u, seat_axis_v, seat_axis_n))
for s, side in [(-1,'Left'),(1,'Right')]:
    cylinder(f'{side} seat ejection rail', (s*0.29,-1.05,0.28), (s*0.29,-1.28,1.42), 0.035, 'metal', 12)
    box(f'{side} seat side bolster', (s*0.23,-0.98,0.73), (0.12,0.82,0.55), 'seat', (seat_axis_u, seat_axis_v, seat_axis_n))
# Harness belts on the seat back.
tube_path('Shoulder harness left', [(-0.18,-1.23,1.28),(-0.16,-0.98,0.94),(-0.10,-0.78,0.67)], 0.026, 'fabric', 8)
tube_path('Shoulder harness right', [(0.18,-1.23,1.28),(0.16,-0.98,0.94),(0.10,-0.78,0.67)], 0.026, 'fabric', 8)
box('Harness central buckle', (0,-0.74,0.67), (0.12,0.08,0.10), 'metal')
box('Seat pan front lip', (0,-0.50,0.30), (0.52,0.08,0.11), 'darkmetal')

# Instrument panel: slanted surface faces the pilot (-Y).
panel_n = unit([0, -0.91, 0.414])
panel_u = np.array([1.0, 0.0, 0.0])
panel_v = unit(np.cross(panel_n, panel_u))
panel_face = np.array([0.0, 0.98, 1.02])
box('Main instrument panel housing', panel_face - panel_n*0.10, (1.23, 0.72, 0.22), 'panel', (panel_u, panel_v, panel_n))
# Lower panel cheek blocks.
for s, side in [(-1,'Left'),(1,'Right')]:
    box(f'{side} instrument panel cheek', (s*0.59, 0.90, 0.87), (0.12,0.40,0.60), 'darkmetal')

# A screen face with a bezel and simple emissive symbology (all real geometry).
def display(name, x, y_offset, z_offset, w, h):
    center = panel_face + np.array([x,0,0]) + panel_v*y_offset + panel_n*z_offset
    box(f'{name} bezel', center-panel_n*0.012, (w+0.055,h+0.055,0.055), 'darkmetal', (panel_u,panel_v,panel_n))
    box(f'{name} glass', center+panel_n*0.018, (w,h,0.018), 'screen', (panel_u,panel_v,panel_n))
    # Header/status bars and a map-like grid on the screen.
    for k in range(4):
        yy = -h*0.36 + k*h*0.16
        box(f'{name} status line {k}', center+panel_n*0.030+panel_v*yy+panel_u*(-w*0.27), (w*0.30,h*0.025,0.006), 'green', (panel_u,panel_v,panel_n))
    # Central reticle / route line.
    box(f'{name} vertical display trace', center+panel_n*0.032, (w*0.012,h*0.48,0.006), 'cyan', (panel_u,panel_v,panel_n))
    box(f'{name} horizontal display trace', center+panel_n*0.033, (w*0.70,h*0.012,0.006), 'green', (panel_u,panel_v,panel_n))
    for k in range(3):
        xx=-w*0.32+k*w*0.30
        box(f'{name} lower data block {k}', center+panel_n*0.034+panel_v*(-h*0.39)+panel_u*xx, (w*0.14,h*0.035,0.006), 'cyan', (panel_u,panel_v,panel_n))
    # Soft keys around both sides of the display.
    for s in [-1,1]:
        for k in range(4):
            keyc = center + panel_u*(s*(w*0.5+0.035)) + panel_v*(-h*0.34+k*h*0.22) + panel_n*0.02
            box(f'{name} bezel key {s} {k}', keyc, (0.025,0.055,0.035), 'rubber', (panel_u,panel_v,panel_n))
            sphere(f'{name} key indicator {s} {k}', keyc+panel_n*0.021, 0.008, 'green', 1)

# Three multifunction displays across the center stack.
display('Left multifunction display', -0.37, 0.03, 0.045, 0.34, 0.30)
display('Right multifunction display', 0.37, 0.03, 0.045, 0.34, 0.30)
display('Lower center tactical display', 0.00, -0.30, 0.047, 0.39, 0.20)

# Backup analog instruments above/around the MFDs.
def gauge(name, x, yoff, zoff, radius=0.058):
    c = panel_face + np.array([x,0,0]) + panel_v*yoff + panel_n*zoff
    torus(f'{name} metal bezel', c, radius, 0.009, (panel_u,panel_v,panel_n), 'metal', 28, 8)
    box(f'{name} dark dial', c+panel_n*0.002, (radius*1.72,radius*1.72,0.008), 'rubber', (panel_u,panel_v,panel_n))
    # Tick marks at 8 positions.
    for i in range(8):
        a = math.radians(-125 + i*35)
        du, dv = math.cos(a)*radius*0.70, math.sin(a)*radius*0.70
        p = c+panel_u*du+panel_v*dv+panel_n*0.009
        box(f'{name} tick {i}', p, (0.008,0.020,0.004), 'white', (panel_u,panel_v,panel_n))
    # Needle.
    p1 = c + panel_n*0.014
    p2 = c + panel_u*radius*0.47 + panel_v*radius*0.13 + panel_n*0.014
    cylinder(f'{name} needle', p1, p2, 0.0045, 'red', 8)
    sphere(f'{name} needle hub', p1, 0.009, 'metal', 1)

for i, x in enumerate([-0.48,-0.16,0.16,0.48]):
    gauge(f'Upper backup gauge {i+1}', x, 0.34, 0.055, 0.052)

# Pushbutton clusters and guarded switches on lower panel.
for row in range(2):
    for col in range(7):
        x = -0.49 + col*0.163
        yoff = -0.49 - row*0.075
        p = panel_face + panel_u*x + panel_v*yoff + panel_n*0.035
        cylinder(f'Panel pushbutton {row}-{col}', p, p+panel_n*0.025, 0.015, 'rubber', 12)
        sphere(f'Panel button cap {row}-{col}', p+panel_n*0.029, 0.012, 'white' if (row+col)%4==0 else 'metal', 1)
for i in range(5):
    x=-0.30+i*0.15
    p=panel_face+panel_u*x+panel_v*(-0.59)+panel_n*0.02
    cylinder(f'Panel toggle switch {i}', p, p+panel_n*0.055+panel_v*0.025, 0.007, 'metal', 10)
    torus(f'Panel toggle guard {i}', p+panel_n*0.012, 0.021, 0.004, (panel_u,panel_v,panel_n), 'darkmetal', 16, 6)

# Glareshield and HUD assembly.
box('Glareshield hood', (0,0.78,1.42), (1.12,0.42,0.16), 'rubber')
box('HUD support pedestal', (0,0.63,1.53), (0.22,0.18,0.22), 'darkmetal')
# Thin combiner glass oriented toward pilot.
hud_n = unit([0,-1,0.03])
hud_u = np.array([1.0,0.0,0.0])
hud_v = unit(np.cross(hud_n,hud_u))
box('HUD combiner glass', (0,0.57,1.73), (0.39,0.012,0.30), 'glass', (hud_u,hud_v,hud_n))
# HUD frame and luminous flight-path / pitch ladder.
for s in [-1,1]:
    cylinder(f'HUD side frame {s}', (s*0.22,0.57,1.58), (s*0.22,0.57,1.88), 0.012, 'metal', 10)
for z in [1.65,1.70,1.75,1.80]:
    box(f'HUD pitch ladder {z:.2f}', (0,0.558,z), (0.17 if z!=1.75 else 0.25,0.006,0.004), 'cyan')
box('HUD flight path marker vertical', (0,0.557,1.74), (0.004,0.006,0.11), 'cyan')
box('HUD flight path marker horizontal', (0,0.557,1.74), (0.10,0.006,0.004), 'cyan')

# Center control stick and hand grip.
box('Control stick boot', (0.12,-0.34,0.47), (0.19,0.20,0.10), 'rubber')
cylinder('Control stick shaft', (0.12,-0.34,0.51), (0.16,-0.24,0.86), 0.025, 'metal', 14)
sphere('Control stick grip', (0.16,-0.22,0.90), 0.075, 'rubber', 2, scale=[0.72,0.75,1.25])
box('Stick trigger', (0.16,-0.17,0.94), (0.045,0.035,0.065), 'yellow')
for i in range(3):
    sphere(f'Stick top switch {i}', (0.12+i*0.035,-0.225,0.965), 0.012, 'red' if i==0 else 'metal', 1)

# Left throttle quadrant and right-side avionics console.
for s, side in [(-1,'Left'),(1,'Right')]:
    # Raised console top, slightly canted toward the pilot.
    console_center=(s*0.535,0.00,0.80)
    box(f'{side} side console body', console_center, (0.20,1.68,0.42), 'panel')
    box(f'{side} console top surface', (s*0.525,0.00,1.025), (0.22,1.62,0.06), 'darkmetal')
    # rows of pushbuttons / rotary controls.
    for r in range(3):
        for c in range(5):
            yy=-0.60+c*0.28
            xx=s*(0.49+r*0.045)
            p=(xx,yy,1.07)
            cylinder(f'{side} console rotary {r}-{c}', (p[0],p[1],p[2]), (p[0],p[1],p[2]+0.035), 0.017, 'rubber', 12)
            sphere(f'{side} console rotary cap {r}-{c}', (p[0],p[1],p[2]+0.04), 0.015, 'metal', 1)
    # Console edge rails.
    box(f'{side} console outer rail', (s*0.65,0.00,1.075), (0.035,1.64,0.05), 'metal')

# Throttle grip on the left console, with a long travel slot.
box('Throttle travel slot', (-0.53,0.45,1.079), (0.10,0.58,0.012), 'rubber')
tube_path('Throttle lever stem', [(-0.53,0.22,1.10),(-0.53,0.32,1.23),(-0.53,0.42,1.28)], 0.018, 'metal', 10)
box('Throttle grip', (-0.53,0.43,1.30), (0.09,0.18,0.08), 'rubber')
for i in range(3):
    sphere(f'Throttle grip button {i}', (-0.575+i*0.04,0.43,1.34), 0.012, 'red' if i==0 else 'yellow', 1)
# Right console guarded switch / comms cluster.
for i in range(4):
    x=0.54
    y=-0.52+i*0.24
    cylinder(f'Right guarded switch {i}', (x,y,1.075), (x,y,1.15), 0.008, 'metal', 10)
    torus(f'Right switch guard {i}', (x,y,1.10), 0.035, 0.005, ([1,0,0],[0,1,0],[0,0,1]), 'yellow', 16, 6)

# Rudder pedals in front footwell.
for s, side in [(-1,'Left'),(1,'Right')]:
    cylinder(f'{side} rudder pedal arm', (s*0.20,0.77,0.18), (s*0.20,0.94,0.47), 0.018, 'metal', 10)
    box(f'{side} rudder pedal plate', (s*0.20,0.96,0.43), (0.17,0.07,0.21), 'darkmetal')
    for k in range(4):
        box(f'{side} pedal grip rib {k}', (s*0.20,0.918,0.36+k*0.045), (0.13,0.012,0.012), 'metal')

# Ejection handles: yellow/black style safety handles near seat front.
for s, side in [(-1,'Left'),(1,'Right')]:
    tube_path(f'{side} ejection handle yellow loop', [(s*0.12,-0.61,0.42),(s*0.12,-0.58,0.54),(s*0.07,-0.55,0.57),(s*0.07,-0.53,0.45)], 0.014, 'yellow', 10)
    for k in range(4):
        box(f'{side} ejection handle black grip band {k}', (s*0.10,-0.57+k*0.018,0.53), (0.027,0.012,0.018), 'rubber')

# Canopy bow and open frame rails (no large transparent canopy shell, to keep visibility high).
for s, side in [(-1,'Left'),(1,'Right')]:
    tube_path(f'{side} canopy side frame', [(s*0.66,-1.22,1.04),(s*0.69,-0.80,1.35),(s*0.69,0.12,1.58),(s*0.65,0.85,1.45)], 0.022, 'metal', 12)
# Transverse bow over the pilot's head.
tube_path('Canopy transverse bow', [(-0.68,-0.18,1.46),(-0.48,-0.18,1.60),(0,-0.18,1.66),(0.48,-0.18,1.60),(0.68,-0.18,1.46)], 0.025, 'darkmetal', 12)
# Small canopy latch hardware.
for s in [-1,1]:
    box(f'Canopy latch block {s}', (s*0.66,0.74,1.30), (0.08,0.12,0.07), 'darkmetal')
    sphere(f'Canopy latch pin {s}', (s*0.66,0.74,1.35), 0.018, 'metal', 1)

# Ventilation outlets and side-panel labels/indicator strips.
for s, side in [(-1,'Left'),(1,'Right')]:
    box(f'{side} air vent panel', (s*0.53,-0.94,0.94), (0.025,0.24,0.09), 'darkmetal')
    for k in range(5):
        box(f'{side} air vent slat {k}', (s*0.512,-1.03+k*0.045,0.94), (0.008,0.012,0.065), 'metal')
    # Status lamps on the cockpit side wall.
    for k, col in enumerate(['green','yellow','red']):
        sphere(f'{side} status lamp {k}', (s*0.515,0.50+k*0.09,0.88), 0.018, col, 1)

# A few structural fasteners around the tub and floor.
for s in [-1,1]:
    for yy in [-1.10,-0.60,-0.10,0.40,0.90]:
        sphere(f'Tub rim fastener {s}-{yy}', (s*0.61,yy,0.985), 0.012, 'metal', 1)

# Convert from authoring axes (Z-up, forward +Y) to glTF axes (Y-up, forward -Z).
# A -90 degree X rotation maps source +Z to glTF +Y and source +Y to glTF -Z.
axis_fix = trimesh.transformations.rotation_matrix(-math.pi / 2.0, [1, 0, 0])
scene.apply_transform(axis_fix)

# Export as GLB (binary glTF). Keep scene nodes/materials separate for easy editing.
scene.metadata['asset_name'] = 'F-16-inspired fictional fighter cockpit'
scene.metadata['units'] = 'meters'
scene.metadata['coordinate_system'] = 'glTF: +Y up, forward -Z (converted from authoring axes X right, Y forward, Z up)'
scene.metadata['notes'] = 'Fictionalized game-ready cockpit interior. Not an exact aircraft technical replica.'
scene.export(OUT, file_type='glb')

# Reload the exported file and report actual triangle count.
loaded = trimesh.load(OUT, force='scene')
triangles = sum(len(g.faces) for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh))
vertices = sum(len(g.vertices) for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh))
print(f'Wrote: {OUT}')
print(f'Geometry nodes: {len(loaded.geometry)}')
print(f'Triangles: {triangles:,}')
print(f'Vertices: {vertices:,}')
print(f'File size: {OUT.stat().st_size/1024/1024:.2f} MiB')
