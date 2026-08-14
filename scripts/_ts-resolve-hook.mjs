/**
 * `_ts-resolve.mjs` tarafından kaydedilen resolve hook'u.
 * Gerekçe orada yazıyor; burası sadece mekanizma.
 */
export async function resolve(specifier, context, next) {
  if (/^\.{1,2}\//.test(specifier) && specifier.endsWith(".js")) {
    try {
      return await next(specifier.slice(0, -3) + ".ts", context);
    } catch {
      // Gerçekten bir .js dosyasıysa aşağıdaki normal çözümlemeye düşer.
    }
  }
  return next(specifier, context);
}
