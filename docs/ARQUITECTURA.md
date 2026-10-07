# Arquitectura

Guía para entender y modificar el código. El código (nombres de archivos, funciones, variables y comentarios) está en inglés; los textos que ve el usuario están en español.

## Idea general

Es una aplicación web sin dependencias externas: solo necesita Node.js 22.13 o superior.

- **Servidor** (`server.js` + `src/`): sirve los archivos de `public/` y una API JSON bajo `/api/`. Guarda todo en un único archivo SQLite (`data/ventas.db`).
- **Navegador** (`public/`): JavaScript sin framework ni paso de compilación. Lo que editas es lo que se ejecuta.

## Mapa de carpetas

```
server.js                 Servidor HTTP: archivos estáticos, sesión, permisos y reparto a las rutas
src/
  db.js                   Conexión SQLite, tablas, migraciones y copias de seguridad
  defaults.js             Datos iniciales: productos, tipos de garantía y AJUSTES POR DEFECTO
  settings.js             Leer y guardar ajustes
  auth.js                 Contraseñas (scrypt), sesiones y límite de intentos de login
  http.js                 route(), fail() y HttpError
  utils.js                Dinero, fechas y limpieza de textos
  api.js                  Carga todos los archivos de routes/
  routes/
    session.js            Estado, primera instalación, login, logout, mi contraseña
    categories.js         Productos y motivos de gasto
    movements.js          Caja del día, ventas y gastos
    invoices.js           Tickets y facturas
    repairs.js            Resguardos de reparación
    stock.js              Stock de móviles
    purchases.js          Compras de móviles de segunda mano a particulares
    search.js             Buscador general
    stats.js              Cifras del panel del dueño
    settings.js           Guardar ajustes (con validación)
    users.js              Usuarios
    data.js               Exportar/importar CSV y descargar la base de datos
    files.js              Archivos de la tienda
public/
  index.html              Página única
  css/app.css             Todos los estilos
  js/
    app.js                Arranque, login, menú y navegación
    core.js               Cliente de la API, formato de dinero/fechas, iconos, modales, avisos
    invoice.js            Plantillas imprimibles: factura A4 y ticket térmico (58 u 80 mm)
    repair-receipt.js     Resguardo de reparación: folio A4 apaisado con dos copias, o ticket térmico
    qr.js                 Generador de códigos QR (sin librerías)
    paper.js              Papel de seguridad de la tienda: qué dibujos y colores lleva cada documento A4
    security-pattern.js   Los dibujos en sí: marco, emblema, banda, marca de agua y microtexto generados a partir de un texto
    purchase-contract.js  Contrato imprimible de compra de segunda mano (dos copias A4)
    delivery-note.js      Lee el texto de un albarán de proveedor (modelo, IMEIs y precio)
    movement-form.js      Formulario de venta/gasto
    charts.js             Gráficos SVG
    views/                Una pantalla por archivo
      cash-register.js    Caja
      dashboard.js        Panel
      invoices.js         Tickets y facturas (listado, detalle y editor)
      repairs.js          Reparaciones (listado, detalle y editor)
      stock.js            Stock de móviles
      purchases.js        Compras de segunda mano
      search.js           Buscar en todo
      movements.js        Movimientos
      files.js            Archivos
      settings.js         Ajustes
scripts/                  demo-data.js, reset-password.js, release.sh, set-github-user.sh
test/api.test.js          Prueba de la API de principio a fin
atik-movilcity/           Paquete de la app para la tienda comunitaria de Umbrel
```

## Cómo viaja una petición

1. El navegador llama a `api('/invoices', { method: 'POST', body })` (`public/js/core.js`).
2. `server.js` busca la ruta, lee la cookie de sesión y comprueba el nivel de acceso de la ruta.
3. Se ejecuta el *handler* de la ruta, que valida los datos y usa `db.js` para leer o escribir.
4. Lo que devuelve el handler se envía como JSON. Si algo no es válido, el handler llama a `fail(400, 'mensaje')` y el navegador muestra ese mensaje.

Una ruta se declara así:

```js
route('POST', '/api/admin/users', 'admin', ({ body, user, params, query }) => {
  // ...
  return { ok: true };
});
```

El tercer argumento es el acceso: `'public'` (sin sesión), `'user'` (cualquier usuario) o `'admin'`.

**Los permisos se aplican siempre en el servidor.** El navegador solo oculta botones; quien decide qué datos recibe un trabajador es la ruta (ver `routes/movements.js`).

## Convenciones

| Tema | Regla |
|---|---|
| Dinero | En la base de datos, **céntimos** (enteros). En la API y el navegador, **euros**. La conversión se hace en las rutas con `cents()` y `euros()` de `utils.js`. |
| Fechas | Texto `AAAA-MM-DD` en hora local. "Hoy" lo decide el servidor. |
| Precios | Siempre con IVA incluido. El desglose (base + IVA) solo se calcula al imprimir. |
| Borrados | Los movimientos no se borran: se marcan con `deleted_at`. Las facturas se anulan con `voided`. |
| Ajustes | Cada grupo (`shop`, `invoice`, `permissions`…) es una fila JSON en la tabla `settings`, fusionada con los valores de `defaults.js`. |

## Modelo de datos

| Tabla | Contenido |
|---|---|
| `users`, `sessions` | Usuarios (rol `admin` o `worker`) y sesiones abiertas |
| `settings` | Ajustes, una fila por grupo |
| `categories` | Productos (`kind = 'sale'`) y motivos de gasto (`kind = 'expense'`). Cada producto tiene su `warranty` por defecto |
| `movements` | Una fila por venta o gasto |
| `invoices` | Tickets (`kind = 'ticket'`) y facturas (`kind = 'factura'`). Las líneas van en `items` como JSON |
| `repairs` | Resguardos de reparación: cliente, terminal, averías, importe, señal, fecha prevista y estado (`pending` / `collected`; con `ready_at` relleno está lista para recoger) |
| `devices` | Móviles en stock: coste, precio previsto y, al venderse, la venta (`movement_id`) |
| `purchases` | Compras de segunda mano: vendedor, móvil, precio y la foto del DNI (el archivo está en `data/id-documents/`) |
| `files` | Datos de los archivos subidos; el contenido está en `data/files/` |

El esquema completo, comentado, está al principio de `src/db.js`.

### Garantías e IVA en un documento

- Los tipos de garantía viven en el ajuste `invoice.warranties` (`[{ name, text }]`).
- Cada producto guarda el nombre de su garantía por defecto. En el editor, al escribir una línea que empieza por el nombre de un producto se propone esa garantía.
- Al guardar, el servidor copia el **texto** de la garantía dentro de cada línea (`warranty_text`). Así, cambiar un texto en Ajustes no altera documentos ya emitidos.
- Cada documento guarda `show_vat`: si se imprime el desglose de IVA o solo el total.

### Papel de seguridad

- `security-pattern.js` dibuja en SVG el marco, el emblema, la banda, la marca de agua y el microtexto. Todo sale de un generador de números aleatorios con semilla: el mismo texto da siempre el mismo dibujo.
- La semilla es el ajuste `invoice.paper_seed`; si está vacío, el nombre y el NIF de la tienda (`paperSeed()` en `paper.js`).
- `invoice.paper_style` elige entre el papel de seguridad (`security`) y el liso (`plain`).
- Las plantillas (factura, contrato y resguardo) no llaman a los dibujos directamente: piden `securityPaper(settings)` a `paper.js`, que devuelve las piezas (`layer`, `emblem`, `band`, `rule`) o `null` si el papel es liso. Los colores salen de `documentColors(settings)`.
- El resguardo de reparación pide el marco en tamaño A5, uno por copia.
- Los dibujos se guardan en memoria por semilla, porque el editor de facturas repinta la vista previa en cada tecla.
- Las paletas de *Ajustes → Apariencia* (`PALETTES` en `views/settings.js`) guardan a la vez los colores de la app (`appearance`) y los de los documentos (`invoice.color_*`).

## Cómo está escrita una pantalla

Todas las pantallas de `public/js/views/` siguen el mismo patrón:

1. **Funciones pequeñas que devuelven HTML** (`movementsTable()`, `kpiCard()`…). Reciben datos y devuelven texto; no tocan la página.
2. **Una función `render…` por pantalla**, que pinta el HTML, guarda el estado en variables locales (`let date`, `let movements`) y define las acciones (`load()`, `save()`, `deleteMovement()`…).
3. **Los eventos al final**, con `on(root, 'click', '[data-edit]', …)`. Los elementos se localizan por atributos `data-…`, nunca por clases de estilo.

Tres ayudas de `core.js` aparecen en todas partes:

| Función | Para qué |
|---|---|
| `on(root, tipo, selector, fn)` | Escuchar un evento en cualquier elemento que cumpla el selector, aunque se pinte después |
| `reloadView()` | Volver a pintar la pantalla actual desde cero tras un cambio. **No llames a la función `render…` otra vez sobre el mismo contenedor**: los eventos se duplicarían |
| `tryApi(ruta, opciones)` | Llamar a la API mostrando el error como aviso; devuelve `undefined` si falla |
| `esc(texto)` | Escapar cualquier dato antes de meterlo en HTML. **Obligatorio** con todo lo que escribe un usuario |

## Dónde tocar para…

| Quiero… | Archivo |
|---|---|
| Cambiar el diseño de la factura o del ticket | `public/js/invoice.js` y la sección *invoices* de `public/css/app.css` |
| Cambiar el resguardo de reparación | Textos: *Ajustes → Reparaciones*. Diseño: `public/js/repair-receipt.js` y la sección *repairs* de `app.css` |
| Añadir un ajuste | `DEFAULT_SETTINGS` en `src/defaults.js` y una sección de `SCHEMAS` en `public/js/views/settings.js` (el formulario se genera solo) |
| Añadir una pestaña de Ajustes | `TAB_GROUPS` en `public/js/views/settings.js`, más su entrada en `SCHEMAS` o en `CUSTOM_TABS` |
| Añadir una pantalla | Crear `public/js/views/mi-vista.js` y registrarla en `ROUTES` de `public/js/app.js`, indicando su grupo del menú |
| Añadir una ruta a la API | El archivo correspondiente de `src/routes/` (o uno nuevo, añadiéndolo en `src/api.js`) |
| Añadir una columna a una tabla | El `CREATE TABLE` y la función `migrate()` de `src/db.js` (la migración actualiza las bases de datos ya existentes) |
| Cambiar los productos o garantías iniciales | `src/defaults.js` (solo afecta a instalaciones nuevas) |

## Probar un cambio

```bash
npm run demo     # app con datos de ejemplo en http://localhost:3001 (admin / admin123)
npm test         # arranca el servidor con una base de datos temporal y recorre los flujos principales
```

`npm test` cubre la API (login, permisos, caja, tickets y facturas, reparaciones, ajustes, CSV, archivos). **No cubre las pantallas**: después de tocar algo en `public/`, compruébalo a mano en la demo.

## Publicar una versión

```bash
bash scripts/release.sh 1.2.0
```

El script ejecuta las pruebas, cambia el número de versión, hace commit, crea la etiqueta `v1.2.0` y lo sube. GitHub Actions construye la imagen Docker (3-5 min) y Umbrel ofrece **Update**. Los datos no se pierden al actualizar: están fuera del contenedor y `migrate()` adapta la base de datos.

## Lo que sigue en español, y por qué

- **Textos de la interfaz y mensajes de error**: los lee el usuario.
- **Direcciones de la app** (`#/caja`, `#/facturas/nueva`…): se ven en la barra del navegador.
- **Valores ya guardados**: `kind = 'factura'`, el archivo `ventas.db` y las cabeceras del CSV. Cambiarlos obligaría a convertir las bases de datos existentes.
