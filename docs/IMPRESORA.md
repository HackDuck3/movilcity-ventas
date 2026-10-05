# Impresora de tickets (Premier ITP-58 III) en Windows 10

## Qué puede hacer esta impresora

| Dato | Valor |
|---|---|
| Papel | **58 mm** de ancho (unos 48 mm imprimibles) |
| Resolución | 203 ppp, 384 puntos por línea |
| Conexión | USB |
| Lenguaje | ESC/POS |

La aplicación imprime desde el navegador, como cualquier página. Eso significa:

- **Sí imprime el código QR, el logo y el patrón de desbloqueo**, porque el navegador los envía como imagen. Para eso hace falta el **driver de la impresora**: con el driver "Generic / Text Only" de Windows solo sale texto.
- Los tickets y los resguardos ya están ajustados a 58 mm (*Ajustes → Tickets y facturas → Ancho del papel térmico*).
- El resguardo de reparación, con todas las condiciones, sale largo (unos 45 cm). Si quieres gastar menos papel, acorta el texto en *Ajustes → Reparaciones*.

> No he podido probar la impresora físicamente. Lo que sigue son los pasos habituales para este tipo de impresora; el primer ticket real es la prueba.

## Instalar el driver

1. **Consigue el driver**. Por orden de preferencia:
   - El CD o la página del vendedor donde compraste la impresora.
   - Pedírselo al distribuidor (Premier): modelo **ITP-58 III**, código interno 3372.
   - Los drivers genéricos **"POS-58"** suelen funcionar con estas impresoras. Una tienda de TPV publica uno para "ITP-58 · 58 mm · USB · Windows 10" en su [página de descargas](https://ventatpv.com/blog/descarga-drivers-para-impresoras-de-tickets-de-varios-modelos-n4). Es un archivo de terceros que no he verificado: pásale el antivirus antes de instalarlo.
2. Conecta la impresora por USB y enciéndela **antes** de instalar.
3. Ejecuta el instalador. Cuando pregunte el puerto, elige **USB001** (o el USB00x más alto que aparezca: es el de "Compatibilidad con impresoras USB").
4. En *Configuración → Dispositivos → Impresoras y escáneres* abre la impresora → **Administrar → Imprimir página de prueba**.
   - Si no sale nada, entra en *Propiedades de impresora → Puertos* y prueba con otro USB00x.

## Ajustar el papel

En *Administrar → Preferencias de impresión*:

- Tamaño de papel: **58 mm** (a veces aparece como `58(48) x 210 mm` o `58 x 3276 mm`). Si puedes elegir, el más largo.
- Si los tickets salen cortados a lo ancho, es que hay seleccionado un papel de 80 mm.

## Imprimir desde la app (Chrome o Edge)

La primera vez, en la ventana de impresión abre **Más ajustes** y deja:

| Opción | Valor |
|---|---|
| Destino | La impresora de tickets |
| Tamaño del papel | 58 mm |
| Márgenes | **Ninguno** |
| Escala | 100 |
| Encabezados y pies de página | **Desactivado** |
| Gráficos de fondo | Activado |

Chrome recuerda estos valores para la próxima vez.

### Imprimir sin que aparezca la ventana (opcional)

Si en ese ordenador solo se imprimen tickets:

1. Pon la impresora de tickets como **predeterminada** en Windows.
2. Crea un acceso directo a Chrome y, en *Propiedades → Destino*, añade al final: ` --kiosk-printing`
3. Abre la app siempre desde ese acceso directo: "Guardar e imprimir" imprimirá directamente.

Para imprimir una factura en A4 desde ese mismo ordenador habrá que abrir Chrome normal.

## Problemas habituales

| Síntoma | Causa probable |
|---|---|
| Sale texto raro o símbolos | Driver equivocado o "Generic / Text Only" |
| El QR no sale o sale como letras | Igual: falta el driver correcto |
| Ticket cortado por la derecha | Papel de 80 mm seleccionado, o el ancho en Ajustes no es 58 |
| Mucho papel en blanco al final | Tamaño de papel fijo y largo en el driver; elige uno más corto o "recibo" |
| El QR no se lee con el móvil | Papel gastado o cabezal sucio; prueba con un enlace más corto (QR con menos puntos) |
