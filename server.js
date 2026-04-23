// Shim de entrada para PaaS (Nixpacks/EasyPanel/Render etc.) que detectam
// `node server.js` por padrão. O código real está em backend/server.js.
// Mantido aqui para que o autodetect do Nixpacks continue funcionando
// mesmo após a separação backend/frontend.
require("./backend/server");
