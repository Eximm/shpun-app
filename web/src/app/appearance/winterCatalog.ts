export const WINTER_DECORATIONS = [
  { id: "bauble", image: "/themes/winter-bauble.webp" },
  { id: "bell", image: "/themes/icons/bell.png" },
  { id: "ribbon", image: "/themes/icons/ribbon.png" },
  { id: "snowflake", image: "/themes/icons/snowflake.png" },
  { id: "star", image: "/themes/icons/star.png" },
  { id: "candy", image: "/themes/icons/candy.png" },
  { id: "gift", image: "/themes/icons/gift.png" },
  { id: "snowman", image: "/themes/icons/snowman.png" },
] as const;
export type DecorationKind = typeof WINTER_DECORATIONS[number]["id"];
export function decorationImage(kind?: string) {
  return (WINTER_DECORATIONS.find((item) => item.id === kind) ?? WINTER_DECORATIONS[0]).image;
}
