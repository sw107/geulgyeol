import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({
 base:'/studio/',
 define:{__APP_VERSION__:JSON.stringify('0.8.6'),__RHWP_DISABLE_EXTERNAL_WEBFONTS__:'true',__RHWP_HWPCTRL__:'true'},
 resolve:{alias:{'@':resolve(import.meta.dirname,'src'),'@wasm/rhwp.js':resolve(import.meta.dirname,'../pkg/rhwp.js'),'@wasm':resolve(import.meta.dirname,'../pkg'),'@rhwp/hwpctrl/studio-plugin':resolve(import.meta.dirname,'../npm/hwpctrl-ocx/src/studio-plugin.mjs')}},
 build:{outDir:resolve(import.meta.dirname,'../desktop/web/studio'),emptyOutDir:true}
});
