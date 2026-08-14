/**
 * `./x.js` → `./x.ts` çözümleyici — yalnızca scripts/ için.
 *
 * NEDEN VAR: `api/` altındaki modüller birbirini `.js` uzantısıyla import
 * ediyor ve bu ZORUNLU. Vercel her `api/**./*.ts` dosyasını ayrı ayrı `.js`'e
 * derliyor ama import yolundaki uzantıyı yeniden YAZMIYOR; kaynakta `.ts`
 * yazarsan derlenmiş `.js` içinde de `.ts` kalıyor ve production'da
 * `ERR_MODULE_NOT_FOUND` alıyorsun. (Bu bir kez canlıda 500'e yol açtı.)
 *
 * Node ise TypeScript'i doğrudan çalıştırırken (tip sıyırma) `.js` → `.ts`
 * eşlemesi yapmıyor, yani scripts/ altındaki araçlar aynı modülleri
 * import edemiyor. Bu hook o boşluğu kapatıyor: yalnızca göreli `.js`
 * yollarını dener, bulamazsa olduğu gibi devam eder.
 *
 * Kullanım (package.json script'leri bunu zaten yapıyor):
 *   node --import ./scripts/_ts-resolve.mjs scripts/poster-samples.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./_ts-resolve-hook.mjs", pathToFileURL("./scripts/"));
