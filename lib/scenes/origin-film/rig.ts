import * as THREE from "three";
import { flavors } from "@/lib/flavors";
import { glPalette } from "@/lib/palette";
import {
  createCanParts,
  getCanLayout,
} from "@/lib/scenes/hero-can/can-geometry";

/** Build the origin film's instanced yerba leaves without renderer ownership. */
export function buildLeaves(count: number): THREE.InstancedMesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 58);
  shape.bezierCurveTo(45, 42, 50, -28, 0, -62);
  shape.bezierCurveTo(-50, -28, -45, 42, 0, 58);

  const geometry = new THREE.ShapeGeometry(shape, 10);
  const material = new THREE.MeshStandardMaterial({
    color: glPalette.leaf,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  const leaves = new THREE.InstancedMesh(geometry, material, count);
  leaves.name = "origin-film-leaves";
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return leaves;
}

/** Build the animated liquid column and expose its shader for uniform updates. */
export function buildBrew(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uFill: { value: 0 } },
    vertexShader:
      "uniform float uTime; varying vec3 vW; void main(){ vec3 d=position+normal*sin(position.y*.04+uTime*1.7)*4.; vec4 w=modelMatrix*vec4(d,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}",
    fragmentShader:
      // Palette exemption: these bespoke liquid-gradient stops are shader
      // coefficients rather than Three.js color literals. Moving them to a
      // JS palette value would change the original shader interpolation.
      "uniform float uOpacity; uniform float uFill; varying vec3 vW; void main(){ float liquid=smoothstep(-100., 110., vW.y+uFill*220.); gl_FragColor=vec4(mix(vec3(.83,.38,.12),vec3(.98,.68,.25),liquid),uOpacity*liquid*.88);}",
  });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(100, 100, 220, 48, 1, true),
    material,
  );
  mesh.name = "origin-film-brew";
  mesh.position.set(0, -20, -55);
  return { mesh, material };
}

/** Build the open collection basket used in the harvest beat. */
export function buildBasket(): THREE.Mesh {
  const basket = new THREE.Mesh(
    new THREE.CylinderGeometry(100, 78, 64, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: glPalette.amber,
      roughness: 0.6,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  basket.name = "origin-film-basket";
  basket.position.set(0, -80, 20);
  return basket;
}

export interface MachineRigOptions {
  simplified?: boolean;
}

/** Build the processing rollers and drying drum, with a compact mobile tier. */
export function buildMachine({ simplified = false }: MachineRigOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = "origin-film-machine";
  group.userData.variant = simplified ? "simplified" : "full";
  const material = new THREE.MeshStandardMaterial({
    color: glPalette.ochre,
    roughness: 0.42,
    metalness: 0.12,
  });
  const roller = new THREE.CylinderGeometry(
    simplified ? 30 : 34,
    simplified ? 30 : 34,
    simplified ? 160 : 220,
    simplified ? 8 : 16,
  );
  const rollerOffsets = simplified ? [-54, 54] : [-144, -72, 0, 72, 144];

  for (const x of rollerOffsets) {
    const mesh = new THREE.Mesh(roller, material);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, 0, 0);
    group.add(mesh);
  }

  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(
      simplified ? 78 : 102,
      simplified ? 78 : 102,
      simplified ? 110 : 150,
      simplified ? 12 : 24,
    ),
    new THREE.MeshStandardMaterial({ color: glPalette.amber, roughness: 0.35 }),
  );
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0, simplified ? 98 : 125, -20);
  group.add(drum);
  group.position.set(0, 0, -80);
  return group;
}

/** Build the carton, its two open flaps, and packing tape. */
export function buildCarton(): THREE.Group {
  const group = new THREE.Group();
  group.name = "origin-film-carton";
  const material = new THREE.MeshStandardMaterial({ color: glPalette.clay, roughness: 0.7 });

  group.add(new THREE.Mesh(new THREE.BoxGeometry(300, 160, 170), material));

  for (const side of [-1, 1]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(145, 8, 170), material);
    flap.position.set(side * 75, 84, 0);
    group.add(flap);
  }

  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(32, 166, 174),
    new THREE.MeshStandardMaterial({ color: glPalette.amber, roughness: 0.55 }),
  );
  group.add(tape);
  group.position.set(0, -30, -30);
  return group;
}

export interface HandRigOptions {
  silhouette?: boolean;
}

/** Build the articulated desktop hand or a single-mesh mobile silhouette. */
export function buildHand({ silhouette = false }: HandRigOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = "origin-film-hand";
  group.userData.variant = silhouette ? "silhouette" : "articulated";

  if (silhouette) {
    const shape = new THREE.Shape();
    shape.moveTo(-68, -48);
    shape.lineTo(48, -48);
    shape.quadraticCurveTo(72, -18, 60, 18);
    shape.lineTo(42, 72);
    shape.quadraticCurveTo(31, 88, 20, 66);
    shape.lineTo(10, 38);
    shape.lineTo(2, 84);
    shape.quadraticCurveTo(-4, 101, -16, 82);
    shape.lineTo(-25, 38);
    shape.lineTo(-39, 70);
    shape.quadraticCurveTo(-49, 84, -58, 62);
    shape.lineTo(-48, 22);
    shape.quadraticCurveTo(-78, 5, -68, -48);

    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 6),
      new THREE.MeshBasicMaterial({ color: glPalette.amber, side: THREE.DoubleSide }),
    );
    mesh.name = "origin-film-hand-silhouette";
    group.add(mesh);
    group.position.set(0, -220, 340);
    group.visible = false;
    return group;
  }

  const skin = new THREE.MeshStandardMaterial({ color: glPalette.amber, roughness: 0.7 });
  const palm = new THREE.Mesh(new THREE.SphereGeometry(70, 20, 16), skin);

  palm.scale.set(1, 0.55, 0.28);
  group.add(palm);

  for (let index = 0; index < 4; index += 1) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(14, 70, 6, 12), skin);
    finger.position.set(-46 + index * 31, 55, 4);
    finger.rotation.z = 0.12 - index * 0.08;
    group.add(finger);
  }

  group.position.set(0, -220, 340);
  group.visible = false;
  return group;
}

export interface BuiltShelf {
  group: THREE.Group;
  parts: {
    shell: THREE.InstancedMesh;
    lid: THREE.InstancedMesh;
    tab: THREE.InstancedMesh;
    label: THREE.InstancedMesh;
  };
  count: number;
  setMatrixAt(index: number, matrix: THREE.Matrix4): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

/** Build the requested canonical flavor row as four shared instanced can parts. */
export function buildShelf(flavorCount: number): BuiltShelf {
  const count = Math.max(0, Math.min(flavors.length, Math.floor(flavorCount)));
  const geometries = createCanParts();
  const layout = getCanLayout();
  const materials = {
    shell: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.38 }),
    lid: new THREE.MeshStandardMaterial({ color: 0xd8d8d2, metalness: 0.4, roughness: 0.3 }),
    tab: new THREE.MeshStandardMaterial({ color: 0x9a9a94, metalness: 0.45, roughness: 0.35 }),
    label: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.08 }),
  };
  const parts = {
    shell: new THREE.InstancedMesh(geometries.shell, materials.shell, count),
    lid: new THREE.InstancedMesh(geometries.lid, materials.lid, count),
    tab: new THREE.InstancedMesh(geometries.tab, materials.tab, count),
    label: new THREE.InstancedMesh(geometries.labelCylinder, materials.label, count),
  };
  parts.shell.name = "origin-film-shelf-shells";
  parts.lid.name = "origin-film-shelf-lids";
  parts.tab.name = "origin-film-shelf-tabs";
  parts.label.name = "origin-film-shelf-labels";

  for (const mesh of Object.values(parts)) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
  }

  const identity = new THREE.Matrix4();
  flavors.slice(0, count).forEach((flavor, index) => {
    parts.shell.setColorAt(index, new THREE.Color(flavor.can));
    parts.label.setColorAt(index, new THREE.Color(flavor.accent));
    for (const mesh of Object.values(parts)) mesh.setMatrixAt(index, identity);
  });
  if (parts.shell.instanceColor) parts.shell.instanceColor.needsUpdate = true;
  if (parts.label.instanceColor) parts.label.instanceColor.needsUpdate = true;

  const lidOffset = new THREE.Matrix4().makeTranslation(0, layout.topOpeningY, 0);
  const partMatrix = new THREE.Matrix4();
  const group = new THREE.Group();
  group.name = "origin-film-shelf";
  group.add(parts.shell, parts.lid, parts.tab, parts.label);

  function setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    if (index < 0 || index >= count) return;
    parts.shell.setMatrixAt(index, matrix);
    parts.label.setMatrixAt(index, matrix);
    partMatrix.multiplyMatrices(matrix, lidOffset);
    parts.lid.setMatrixAt(index, partMatrix);
    parts.tab.setMatrixAt(index, partMatrix);
    for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
  }

  function setOpacity(opacity: number): void {
    group.visible = opacity > 0.005;
    for (const material of Object.values(materials)) {
      material.transparent = opacity < 0.995;
      material.opacity = opacity;
      material.depthWrite = opacity > 0.5;
    }
  }

  function dispose(): void {
    for (const mesh of Object.values(parts)) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    group.clear();
  }

  return { group, parts, count, setMatrixAt, setOpacity, dispose };
}
