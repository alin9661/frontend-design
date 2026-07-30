// DECISION POINT: flavor palette + taglines — tweak colors/copy here to reshape the whole showcase section.

export type Flavor = {
  id: string;
  name: string;
  tagline: string;
  bg: string;
  can: string;
  accent: string;
  ink: string;
};

export const flavors: Flavor[] = [
  {
    id: "lemon",
    name: "Lemon Original",
    tagline:
      "Crisp lemon with a smooth tea finish, like classic half-and-half iced tea.",
    bg: "#F2C94C",
    can: "#F7E27A",
    accent: "#B98A12",
    ink: "#1D423C",
  },
  {
    id: "peach",
    name: "Peach Passion",
    tagline:
      "Juicy peach with tropical undertones, inspired by classic peach tea.",
    bg: "#F2994A",
    can: "#F8B87E",
    accent: "#B95E13",
    ink: "#1D423C",
  },
  {
    id: "mint",
    name: "Mint Limeade",
    tagline:
      "Aromatic garden mint paired with zesty lime and smooth yerba mate.",
    // Deepened from #3FA88E so cream ink (#F9F9EE) clears 4.5:1 (measures 5.17:1).
    bg: "#24765F",
    can: "#7CC9B5",
    accent: "#14574A",
    ink: "#F9F9EE",
  },
  {
    id: "raspberry",
    name: "Raspberry Yuzu",
    tagline:
      "Tart raspberry and vibrant yuzu create a bold, citrusy blend with floral notes.",
    // Deepened from #D94F3D so cream ink (#F9F9EE) clears 4.5:1 (measures 5.81:1).
    bg: "#B5301F",
    can: "#E8826F",
    accent: "#8E2417",
    ink: "#F9F9EE",
  },
  {
    id: "mango",
    name: "Mango Key Lime",
    tagline: "Sweet mango meets tangy key lime in this bright, balanced blend.",
    bg: "#A8C24A",
    can: "#C7DA7B",
    accent: "#5F7317",
    ink: "#1D423C",
  },
];

export const brand: { cream: string; forest: string; forestDeep: string } = {
  cream: "#F9F9EE",
  forest: "#1D423C",
  forestDeep: "#142E29",
};
