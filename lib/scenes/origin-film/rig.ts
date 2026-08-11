import * as THREE from "three";
import { flavors } from "@/lib/flavors";
import { glPalette } from "@/lib/palette";
import { buildCan, type BuiltCan } from "@/lib/scenes/hero-can/can-geometry";

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

/** Build the five processing rollers and drying drum. */
export function buildMachine(): THREE.Group {
  const group = new THREE.Group();
  group.name = "origin-film-machine";
  const material = new THREE.MeshStandardMaterial({
    color: glPalette.ochre,
    roughness: 0.42,
    metalness: 0.12,
  });
  const roller = new THREE.CylinderGeometry(34, 34, 220, 16);

  for (let index = -2; index <= 2; index += 1) {
    const mesh = new THREE.Mesh(roller, material);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(index * 72, 0, 0);
    group.add(mesh);
  }

  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(102, 102, 150, 24),
    new THREE.MeshStandardMaterial({ color: glPalette.amber, roughness: 0.35 }),
  );
  drum.rotation.z = Math.PI / 2;
  drum.position.set(0, 125, -20);
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

/** Build the stylized palm and four capsule fingers used in the grab beat. */
export function buildHand(): THREE.Group {
  const group = new THREE.Group();
  group.name = "origin-film-hand";
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

/** Build the requested number of shelf cans in the canonical flavor order. */
export function buildShelf(flavorCount: number): BuiltCan[] {
  const count = Math.max(0, Math.min(flavors.length, Math.floor(flavorCount)));
  return flavors.slice(0, count).map((flavor) => buildCan(flavor));
}
