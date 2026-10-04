# Movil City · Control de ventas

Sustituye las 12 hojas de cálculo mensuales por una aplicación web con **roles** (trabajador / administrador), **panel del dueño**, **tickets y facturas en PDF**, **archivos de la tienda** y **ajustes tipo WordPress**.

> **¿Tienes umbrelOS en la Raspberry Pi?** Sigue **[INSTALAR-UMBREL.md](INSTALAR-UMBREL.md)**. No uses `install.sh`, porque umbrelOS borra al reiniciar lo instalado por SSH.

- **Sin dependencias**: solo necesita Node.js 22.13 o superior (incluye la base de datos SQLite). No hay `npm install`.
- Funciona **sin internet** en la red de la tienda (los gráficos están hechos a mano, no usan librerías externas).
- Usa ~50 MB de RAM: la Raspberry Pi 4 de 2 GB va sobrada.

---

## 1. Por qué web y no Google Sheets

| | Google Sheets | Esta app |
|---|---|---|
| Ocultar totales del mes al trabajador | ❌ Quien tiene acceso al archivo puede ver todo (las hojas ocultas y los rangos protegidos impiden *editar*, no *ver*) | ✅ El servidor ni siquiera le envía esos datos |
| Saber quién apuntó cada venta | Parcial (historial de versiones) | ✅ Cada apunte guarda usuario y hora |
| Evitar que borren ventas | ❌ | ✅ Solo pueden corregir sus apuntes durante X minutos; los borrados quedan registrados |
| 12 hojas × 31 tablas a mano | Sí | ✅ Automático: el dashboard calcula día, mes y año |
| Facturas | Plantilla aparte | ✅ Integradas, numeración automática, PDF |

---

## 2. Instalar en la Raspberry Pi 4 (Raspberry Pi OS)

> Con **umbrelOS**, ve a [INSTALAR-UMBREL.md](INSTALAR-UMBREL.md).

**Requisito:** Raspberry Pi OS **64-bit** (Lite o Desktop). Si la instalas de cero, usa *Raspberry Pi Imager* y en la configuración activa SSH y tu WiFi.

1. Copia la carpeta `movilcity-ventas` a la Pi (por ejemplo a `/home/pi/movilcity-ventas`):
   ```bash
   # desde tu ordenador
   scp -r movilcity-ventas pi@raspberrypi.local:~
   ```
2. En la Pi:
   ```bash
   cd ~/movilcity-ventas
   bash install.sh
   ```
   El script instala Node.js si hace falta, crea un servicio que **arranca solo al encender la Pi** y te muestra la dirección, por ejemplo `http://192.168.1.50:3000`.
3. Abre esa dirección desde el ordenador o el móvil de la tienda (misma WiFi). La primera vez te pedirá **crear la cuenta del administrador**.
4. En **Ajustes → Usuarios** crea un usuario para cada trabajador (basta con un PIN de 4 cifras).

> Consejo: en el router, reserva una IP fija para la Pi para que la dirección no cambie.

### Probar con datos de ejemplo (sin tocar los reales)
```bash
npm run demo        # crea data-demo/ con 2 meses de ventas inventadas
# abre http://<ip-de-la-pi>:3001   →  admin / admin123   ·   trabajador / 1234
```
Para regenerar la demo, borra la carpeta `data-demo/`.

### Ejecutarlo en tu ordenador (Mac/Windows/Linux)
Instala Node.js 22 o superior desde nodejs.org y en la carpeta del proyecto: `npm start` → http://localhost:3000

---

## 3. Cómo se usa

### Trabajador → pantalla **Caja**
- Arriba ve los totales del día que tú le permitas (vendido, beneficio…). **Nunca ve los totales del mes ni del año.**
- Dos botones grandes, uno al lado del otro: **Añadir venta** y **Añadir gasto** (atajos de teclado: `V` y `G`).
- Venta rápida: escribe "fun" → `Enter` (elige *Funda*) → precio → coste o beneficio → `Enter`. El formulario queda listo para la siguiente.
- Si escribe el **coste**, el beneficio se calcula solo (y al revés). Puedes cambiarlo en *Ajustes → Ventas*.
- Botón **Guardar y hacer factura**: guarda la venta y abre la factura ya rellenada.

### Administrador / dueño → **Panel**
- Ventas, beneficio, gastos y **beneficio neto** por día, semana, mes, año o fechas a medida, comparado con el periodo anterior.
- Productos que más beneficio dejan, gastos por motivo, ventas por trabajador y por forma de pago.
- **Día a día**: la tabla que antes hacías en cada hoja, automática. Pulsa un día para abrir su caja.
- **Año completo**: los 12 meses en una tabla (sustituye a tus 12 hojas).
- **Movimientos**: buscar (por IMEI, modelo…), corregir, borrar, **recuperar borrados** y exportar a Excel.

### Importante: cómo se calcula el beneficio neto
En tu hoja, el "balance" era *ventas − gastos*. Pero si cada venta ya lleva su beneficio y además apuntas "compra de móviles 600 €" como gasto, **el coste de esos móviles se resta dos veces**. Por eso cada motivo de gasto es de uno de estos tipos:

- **Mercancía** (compra de móviles, fundas, SIMs…): no resta del beneficio neto, porque ya lo restaste en cada venta.
- **Operativo** (alquiler, luz, sueldos, Mercadona…): sí resta.

| Indicador | Fórmula | Para qué sirve |
|---|---|---|
| Beneficio de ventas | suma del beneficio de cada venta | lo que ganas con el producto |
| **Beneficio neto** | beneficio de ventas − gastos operativos | lo que de verdad gana el negocio |
| Flujo de caja | ventas − todos los gastos | cuánto dinero entra o sale realmente (como tu antiguo "balance") |

---

## 4. Tickets y facturas
Son dos secciones separadas, cada una con su **propia serie de numeración**, como exige la normativa:

| | **Tickets** (factura simplificada) | **Facturas** (factura completa) |
|---|---|---|
| Para | El cliente de mostrador | Quien necesita deducirse el IVA (empresas, autónomos) |
| Datos del cliente | Opcionales | **Obligatorios**: nombre, NIF y dirección (la app no deja guardarla sin ellos) |
| Numeración | Serie `T-1`, `T-2`… | Serie propia (continúa tu numeración anterior) |
| Formato | Ticket 80 mm (o A4, a elegir) | A4 con el diseño de tu plantilla |
| Límite | Hasta 400 € (3.000 € en venta al por menor); la app avisa | Sin límite |

- Desde la **Caja**, cada venta tiene dos iconos: **hacer ticket** o **hacer factura**. También puedes pulsar *Guardar y hacer ticket / factura* al registrarla.
- **Convertir en factura**: si un cliente con ticket vuelve pidiendo factura, abre el ticket y pulsa *Convertir en factura*. La factura indica que "sustituye a la factura simplificada nº T-X" y la venta no se duplica en caja.
- **Tus datos fiscales** (Ajustes → Tienda: nombre y apellidos del titular, NIF y dirección) aparecen automáticamente en todos los PDF. Si faltan, la app te avisa.
- **PDF**: botón *Imprimir / Guardar PDF* y en "Destino" elige **Guardar como PDF**.
- No se borran: se **anulan** (quedan marcados y la numeración no se reutiliza).

> ⚠️ **Aviso legal** (no soy asesor fiscal, confírmalo con tu gestoría):
> - Pregunta a tu gestoría si estás en **recargo de equivalencia** (habitual en comercio minorista), porque cambia cómo se trata el IVA en tus facturas.
> - El reglamento **VeriFactu** (software de facturación homologado) será obligatorio para autónomos en **julio de 2027**. Esta aplicación **no está certificada**: a partir de esa fecha, para la facturación oficial necesitarás un programa homologado o adaptar este. Para el control interno de ventas y gastos no hay problema.

## 4 bis. Archivos de la tienda (solo dueño)
Sección **Archivos**: sube PDFs, fotos y documentos (contratos, facturas de proveedores, impuestos, seguros, garantías…), organizados en carpetas, con búsqueda y notas (por ejemplo, "renovar el 31/12").
- Los trabajadores **no la ven** ni pueden acceder por la dirección: lo bloquea el servidor.
- Se pueden ver en el navegador (PDF e imágenes), descargar, renombrar, mover de carpeta y borrar.
- Se guardan en `data/files` (en Umbrel, dentro de los datos de la app, incluidos en sus copias de seguridad).

## 5. Personalización (estilo WordPress)

Todo desde **Ajustes**, sin tocar código:

| Pestaña | Qué cambias |
|---|---|
| Tienda | Nombre comercial, **titular**, NIF, dirección, teléfono, email, **logo** |
| Apariencia | Colores, modo oscuro, densidad |
| Productos | Añadir, renombrar, color, **orden**, favoritos (salen primero), precio y beneficio sugeridos, activar/desactivar |
| Motivos de gasto | Igual, y si es *mercancía* u *operativo* |
| Usuarios | Altas, bajas, roles, cambiar PIN |
| Permisos | Qué ve el trabajador (vendido/beneficio/gastos del día), si puede apuntar gastos o hacer facturas, minutos para corregir, días de historial |
| Ventas | Coste/beneficio, formas de pago, descripción obligatoria a partir de X € (útil para obligar a poner el IMEI) |
| Tickets y facturas | Series y numeración, títulos, formato del ticket, garantía, pie, IVA, colores |
| Archivos | Carpetas sugeridas y tamaño máximo |
| Módulos | Activar/desactivar tickets y facturas, formas de pago y archivos |
| Datos y copias | Exportar CSV, descargar copia de seguridad, **importar tus hojas antiguas** |

### Si quieres tocar el código
```
server.js            Servidor HTTP (sin Express)
src/db.js            Base de datos, categorías iniciales y AJUSTES POR DEFECTO
src/api.js           Toda la API y los PERMISOS (aquí se decide qué ve cada rol)
src/auth.js          Contraseñas (scrypt) y sesiones
public/css/app.css   Estilos
public/js/app.js     Menú y navegación
public/js/views/     Una pantalla por archivo: caja, dashboard, movimientos, facturas (tickets y facturas), archivos, ajustes
Dockerfile           Imagen para Umbrel / Docker
atik-movilcity/      Paquete de la app para la tienda comunitaria de Umbrel
scripts/             demo, publicar versión, configurar GitHub, recuperar contraseña
public/js/invoice.js Plantilla de la factura A4 y del ticket
public/js/movform.js Formulario de venta/gasto
```
- **Añadir un ajuste nuevo**: añádelo en `DEFAULT_SETTINGS` (`src/db.js`) y en `SCHEMAS` (`public/js/views/ajustes.js`). El formulario se genera solo.
- **Añadir una pantalla**: crea `public/js/views/mi-vista.js` y regístrala en `ROUTES` (`public/js/app.js`).
- Tras cambiar código en la Pi: `sudo systemctl restart movilcity` (los cambios en `public/` basta con recargar el navegador).

---

## 6. Copias de seguridad
- Automáticas cada día en `data/backups/` (se guardan 30 días).
- Toda la información está en un único archivo: `data/ventas.db`. Copiarlo = copia completa.
- Recomendado: una vez por semana descarga una copia desde *Ajustes → Datos y copias* y guárdala fuera de la Pi (la tarjeta SD puede fallar).
- Restaurar: para el servicio (`sudo systemctl stop movilcity`), reemplaza `data/ventas.db` por la copia, borra `ventas.db-wal` y `ventas.db-shm` si existen y vuelve a arrancar.

## 7. Acceder desde fuera de la tienda
Lo más sencillo y seguro es **Tailscale** (gratis): instálalo en la Pi y en tu móvil y entrarás como si estuvieras en la WiFi de la tienda, sin abrir puertos del router. **No abras el puerto 3000 a internet directamente** (no hay HTTPS).

## 8. Pasar a un servidor más adelante
Es exactamente la misma aplicación: copia la carpeta (incluida `data/`) a un VPS con Debian/Ubuntu, ejecuta `bash install.sh` y pon delante un proxy con HTTPS (por ejemplo Caddy: `caddy reverse-proxy --from ventas.tudominio.com --to localhost:3000`).

## 9. Migrar tus hojas actuales
*Ajustes → Datos y copias → Importar CSV* acepta columnas `fecha; tipo; categoria; descripcion; importe; beneficio; metodo_pago`. Como tus hojas tienen un día al lado de otro, primero hay que pasarlas a ese formato (una fila por venta).
