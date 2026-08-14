/**
 * satori için minik element yardımcısı.
 *
 * satori JSX'i zorunlu tutmuyor — `{type, props}` biçimindeki düz nesneleri de
 * kabul ediyor. Bu yol seçildi çünkü `api/` altına React bağımlılığı, JSX
 * derleme ayarı ve ayrı bir tsconfig getirmemek gerekiyor; dosyalar Node'un
 * kendi tip sıyırmasıyla doğrudan çalışıyor.
 */
export interface Node {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

type Child = Node | string | number | false | null | undefined;

export function h(
  type: string,
  props: Record<string, unknown> | null,
  ...children: Child[]
): Node {
  const flat = children.flat(4).filter((c) => c !== null && c !== undefined && c !== false);
  return {
    type,
    props: {
      ...(props ?? {}),
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
  };
}

/** satori her düğümde açık `display` bekliyor; varsayılanı flex yapıyoruz. */
export function box(style: Record<string, unknown>, ...children: Child[]): Node {
  return h("div", { style: { display: "flex", ...style } }, ...children);
}

/** Tek satır metin. */
export function text(style: Record<string, unknown>, value: string): Node {
  return h("div", { style: { display: "flex", ...style } }, value);
}
