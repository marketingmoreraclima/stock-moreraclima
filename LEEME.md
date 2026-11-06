# Stock MoreraClima

App web (móvil y ordenador) para el conteo de stock de material de climatización.

- **Web**: GitHub Pages (esta carpeta: `index.html`, `app.js`, `items.js`, `config.js`).
- **Servidor**: Google Apps Script (`apps-script/Codigo.gs`), proyecto «Stock MoreraClima servidor» en la cuenta marketingmoreraclima@gmail.com.
- **Datos**: hoja «App stock moreraclima» (pestañas *Historial*, *Compras* y *Cambios de mínimos*).
- **Correo**: cada pedido se envía (en pruebas) a marketingmoreraclima@gmail.com y pardomoreraclima@gmail.com; después irá a holamoreraclima@gmail.com. Se cambia en `EMAIL_DESTINO` (Codigo.gs) y `EMAIL` (app.js).
- **Acceso**: con clave. La clave se comprueba en el servidor, no está en el código de esta web.

## 1. Servidor (una vez)
1. En el editor de Apps Script, elige la función `instalar` y pulsa **Ejecutar**. Acepta los permisos (Hojas de cálculo y Gmail).
2. **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: *Yo*. Quién tiene acceso: *Cualquier usuario*. Copia la URL que termina en `/exec`.

## 2. Web
1. Pega esa URL en `config.js` (`window.STOCK_API = "…/exec";`).
2. Sube la carpeta al repositorio y activa **Settings → Pages → Deploy from branch → main / (root)**.

## Cambios habituales
- **Cambiar la clave**: en Apps Script, edita `cambiarClave()` con la nueva clave, guarda y ejecútala.
- **Cambiar el código del servidor**: tras guardar, *Implementar → Gestionar implementaciones → Editar → Nueva versión* (así la URL no cambia).
- **Añadir o cambiar materiales**: edita `items.js` (mínimo, material, proveedor, código, nota; la foto va dentro del propio archivo en base64).
- **Compras**: pestaña «Compras» de la app para José María. Cada conteo enviado crea una línea por material a comprar; José María ajusta la cantidad, pone la fecha y la marca como pedida. Si un material vuelve a salir en un conteo nuevo, la línea pendiente anterior queda «Sustituido».
- **Mínimos**: se cambian en la app (Configuración). Cada cambio queda en la pestaña «Cambios de mínimos» de la hoja.
- **Encargados**: `COUNTERS` al principio de `app.js` (ahora Alonso y Tanit).
