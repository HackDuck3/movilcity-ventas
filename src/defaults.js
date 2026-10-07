'use strict';
// Initial data for a fresh install. Everything here can be changed later from the Settings screen.

const SALE_CATEGORIES = [
  'Movil', 'Tablet', 'Funda', 'Protector', 'Funda y protector', 'Cascos', 'Cable USB', 'Cable Tipo-C',
  'Cable HDMI', 'Cable de red', 'Cable de TV', 'Adaptador', 'PowerBank', 'Reparacion', 'Solucion Tecnica',
  'Cargador', 'Cargador de portatil', 'Soporte para movil', 'Selfie Stick', 'Tarjeta SIM', 'Duplicado',
  'Pendrive', 'Memoria', 'Disco Duro', 'Raton', 'Teclado', 'Webcam', 'Altavoz', 'Karaoke', 'Radio', 'Mando',
  'Ventilador', 'Calefactor', 'Secadora pelo', 'Maquina de barba/pelo', 'Tostadora', 'Batidora',
  'Olla a presion', 'Arrocera', 'Plancha ropa', 'Plancha pelo', 'Consola', 'Reloj despertador', 'Reloj de mano',
  'Reloj inteligente', 'Smart TV Stick', 'Telefono fijo', 'Mechero', 'Copias', 'Impresion', 'Escaneo',
  'Correa', 'OTG', 'Calculadora',
];

const FAVORITE_CATEGORIES = new Set(['Movil', 'Funda', 'Protector', 'Funda y protector', 'Cascos', 'Cargador',
  'Cable USB', 'Cable Tipo-C', 'Reparacion', 'Tarjeta SIM', 'Duplicado', 'Adaptador']);

// 'stock' = goods bought for resale, 'operating' = running costs (rent, bills, food...).
const EXPENSE_CATEGORIES = [
  ['Compra de móviles', 'stock'], ['Compra de accesorios', 'stock'], ['Compra tienda / proveedor', 'stock'],
  ['Tarjetas SIM / recargas', 'stock'], ['Recambios reparación', 'stock'],
  ['Alquiler', 'operating'], ['Luz / agua / internet', 'operating'], ['Sueldos', 'operating'],
  ['Comida / Mercadona', 'operating'], ['Publicidad / web', 'operating'], ['Deuda / préstamo', 'operating'],
  ['Otros gastos', 'operating'],
];

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#0891b2', '#7c3aed', '#be123c', '#4d7c0f', '#b45309', '#475569'];

const WARRANTIES = [
  { name: 'Producto nuevo', text: 'Garantía legal de 3 años desde la entrega.' },
  { name: 'Segunda mano / reacondicionado', text: 'Garantía de 2 años desde la entrega.' },
  { name: 'Reparación', text: 'Garantía de 3 meses desde la entrega. Cubre la reparación realizada y las piezas sustituidas.' },
  { name: 'Software', text: 'Garantía de 15 días de software.' },
];

// Products not listed here get 'Producto nuevo'. An empty string means no warranty.
const WARRANTY_BY_CATEGORY = {
  'Reparacion': 'Reparación', 'Solucion Tecnica': 'Software',
  'Tarjeta SIM': '', 'Duplicado': '', 'Copias': '', 'Impresion': '', 'Escaneo': '',
};
const defaultWarrantyFor = (categoryName) => WARRANTY_BY_CATEGORY[categoryName] ?? 'Producto nuevo';

const REPAIR_FAULTS = [
  'Mojado', 'No carga', 'Altavoz', 'Auricular', 'Botón encendido', 'No enciende', 'Táctil / cristal', 'Pantalla / LCD',
  'Chasis / marco', 'Tapa trasera', 'Botón home', 'Tarjeta SIM / SD', 'Micrófono', 'Cámara trasera / delantera',
  'Liberar', 'Botón de volumen', 'Batería', 'Cobertura / wifi', 'Formatear', 'Jack', 'Sensor',
];

const REPAIR_CONDITIONS = [
  '1. En caso de pérdida o extravío del presente documento, solo podrá ser retirado el terminal objeto de la reparación previa acreditación de la identidad del titular, mediante la exhibición del DNI/NIF aportado en la presente ficha de reparación.',
  '2. En ningún caso se devolverá el importe de la liberación o reparación efectuada si el terminal es bloqueado por la compañía telefónica.',
  '3. Los tiempos de entrega en los códigos de liberación por IMEI son orientativos y pueden sufrir retrasos debido a la dependencia de terceros, no siendo posible su anulación una vez solicitados.',
  '4. La persona que realiza la entrega del móvil para su reparación declara bajo su responsabilidad que es el legítimo propietario del mismo y que no existe impedimento alguno por parte de persona física o jurídica alguna para su manipulación interna, incluido el posible desbloqueo o liberación.',
  '5. Nuestra empresa no se responsabiliza de la pérdida o deterioro de la información contenida en cualquier tipo de soporte; por ello se recomienda encarecidamente que realice una copia de seguridad de aquellos datos importantes que desee.',
  '6. Extraiga y conserve usted las tarjetas SIM y de almacenamiento.',
  'Si en tres meses el terminal no se recoge, procederemos a su retirada.',
].join('\n');

// Draft clauses for buying a used phone from a private seller. Editable in Settings; have an adviser review them.
const PURCHASE_TERMS = [
  '1. El vendedor declara ser mayor de edad y propietario legítimo del terminal, que lo adquirió lícitamente y que no procede de robo, hurto ni extravío.',
  '2. El vendedor declara que el terminal está libre de cargas: no está sujeto a financiación ni a permanencia pendiente, no está bloqueado por ningún operador y su IMEI no figura en listas de terminales bloqueados.',
  '3. El vendedor entrega el terminal sin cuentas asociadas (iCloud, Google, Samsung u otras) ni bloqueos de activación, y facilita los códigos necesarios para restablecerlo.',
  '4. El vendedor ha eliminado, o autoriza al comprador a eliminar, todos los datos personales contenidos en el terminal. El comprador no se responsabiliza de los datos que no se hayan retirado.',
  '5. Si alguna de estas declaraciones resultara falsa, o el terminal quedara bloqueado por una causa anterior a esta venta, el vendedor devolverá íntegramente el precio recibido, sin perjuicio de las acciones legales que correspondan.',
  '6. El vendedor recibe en este acto el precio indicado y declara no tener nada más que reclamar por esta venta.',
  '7. El comprador anota esta operación en su registro de compras de objetos usados y podrá comunicarla a las Fuerzas y Cuerpos de Seguridad conforme a la normativa de seguridad ciudadana.',
  '8. Los datos del vendedor y la copia de su documento de identidad se conservan únicamente para cumplir las obligaciones legales de registro y acreditar la procedencia del terminal.',
].join('\n');

// Notices a new shop starts with. The body uses the simple markup of public/js/notice.js:
// "# " starts a section, "- " a bullet, "| a | b |" a table row and **text** is bold.
const STARTING_NOTICES = [
  {
    title: 'Política de cambios y devoluciones',
    subtitle: 'Telefonía móvil, accesorios y reparación',
    body: [
      'En este establecimiento **no se admiten devoluciones con reembolso del importe**, salvo en caso de producto defectuoso. Algunos productos pueden cambiarse por otro en las condiciones indicadas a continuación.',
      '',
      '# Cambios de producto',
      'Los productos que lo permiten pueden cambiarse por otro producto de la tienda en un plazo de **7 días naturales desde la fecha de compra**, siempre que se cumplan estas condiciones:',
      '- Presentar el ticket o factura de compra original.',
      '- Devolver el producto en su **embalaje original**, completo y con todos sus accesorios.',
      '- El producto no debe presentar golpes, arañazos ni signos de mal uso.',
      'Si el nuevo producto tiene un precio mayor, el cliente abonará la diferencia. Consulte en el momento de la compra si el producto admite cambio.',
      '',
      '# Productos sin cambio',
      '- **Protectores de pantalla** una vez colocados.',
      '- **Tarjetas SIM**, porque se registran a nombre del cliente y no son transferibles.',
      '',
      '# Productos defectuosos y garantía',
      'Si un producto presenta un defecto (tara o fallo de fabricación), el cliente tiene derecho a la garantía legal, con independencia de la política de cambios: reparación o sustitución del producto y, si no fuera posible, rebaja del precio o devolución del importe.',
      '| Tipo de producto | Garantía legal |',
      '| Producto nuevo | 3 años desde la entrega |',
      '| Móvil de segunda mano o reacondicionado | 2 años desde la entrega |',
      'Para hacer uso de la garantía es necesario presentar el ticket o factura de compra. La garantía no cubre daños por golpes, humedad, caídas o mal uso.',
      '',
      '# Reclamaciones',
      'Existen hojas de reclamación a disposición del cliente. Solicítelas en el mostrador.',
    ].join('\n'),
  },
  {
    title: 'Tarifas de reparación de móviles',
    subtitle: 'Servicio de reparación de móviles',
    body: [
      '# Tarifas',
      'Precios mínimos orientativos. El precio final depende de la marca y el modelo, y se indica en el presupuesto antes de reparar. Mano de obra incluida.',
      '| Reparación | Precio |',
      '| Cambio de pantalla | desde … € |',
      '| Cambio de batería | desde … € |',
      '| Conector de carga | desde … € |',
      '| Cámara | desde … € |',
      '| Cristal de cámara | desde … € |',
      '| Bandeja de SIM | desde … € |',
      '| Software o liberación | desde … € |',
      '',
      '# Presupuesto y plazo de entrega',
      'El cliente tiene derecho a solicitar un presupuesto previo por escrito antes de cualquier reparación. El presupuesto es gratuito y no se realiza ninguna reparación sin su aceptación.',
      'Plazo habitual de entrega: **desde 30 minutos hasta 1 día**. Puede ampliarse por falta de stock de la pieza o por la complejidad de la reparación; en ese caso se informará al cliente del nuevo plazo.',
      '',
      '# Garantía de las reparaciones',
      'Todas las reparaciones tienen una garantía de **3 meses** desde la entrega del móvil. La garantía cubre la reparación realizada y las piezas sustituidas.',
      'Las pantallas se prueban junto al cliente en el momento de la entrega. La garantía no cubre:',
      '- Golpes, caídas, pantallas rotas o rayadas tras la entrega.',
      '- Daños por humedad o líquidos.',
      '- Averías distintas de la reparación realizada.',
      '- Dispositivos abiertos o manipulados por terceros después de la reparación.',
      'Para hacer uso de la garantía es necesario presentar el resguardo o factura de la reparación.',
    ].join('\n'),
  },
];

const DEFAULT_SETTINGS = {
  shop: {
    name: 'Movil City',
    legal_name: '',
    address1: '',
    address2: '',
    phone: '',
    email: '',
    nif: '',
    logo: '',
  },
  appearance: {
    appName: 'Movil City · Ventas',
    primary: '#283593',
    accent: '#e91e63',
    dark: false,
    density: 'normal', // 'normal' | 'compact'
  },
  permissions: {
    worker_see_daily_sales: true,
    worker_see_daily_profit: true,
    worker_see_daily_expenses: false,
    worker_add_expenses: true,
    worker_create_invoices: true,
    worker_create_repairs: true,
    worker_create_purchases: false, // buying used phones from customers
    worker_edit_minutes: 15, // 0 = workers can never edit their own entries
    worker_history_days: 0,  // 0 = workers only see today
  },
  sales: {
    payment_methods: ['Efectivo', 'Tarjeta', 'Bizum'],
    ask_payment_method: true,
    require_description_over: 0, // euros; 0 = description is never mandatory
    profit_input: 'both',        // 'both' | 'profit' | 'cost'
  },
  invoice: {
    // Spanish law requires separate number series for full invoices and tickets (simplified invoices).
    next_number: 1,
    prefix: '',
    ticket_next_number: 1,
    ticket_prefix: 'T-',
    title: 'Factura',
    ticket_title: 'Factura simplificada',
    warranties: WARRANTIES,
    footer: '',
    show_vat: false,
    vat_rate: 21,
    color_shop: '#6c63e6',
    color_title: '#283593',
    color_accent: '#e91e63',
    layout: 'sidebar',       // A4 design: 'sidebar' | 'banner' | 'classic'
    ticket_format: 'ticket', // 'ticket' (thermal printer) | 'a4'
    paper_width: 58,         // thermal paper in mm: 58 or 80
    qr_url: '',              // printed as a QR code at the foot of tickets when set
    qr_caption: 'Escanea y déjanos tu opinión',
  },
  repairs: {
    prefix: 'R-',
    next_number: 1,
    faults: REPAIR_FAULTS,
    disclaimer: 'No nos hacemos responsables de cualquier otro fallo que tenga el móvil, solo de nuestra reparación.',
    conditions: REPAIR_CONDITIONS,
    print_format: 'a4', // 'a4' (landscape sheet with two A5 copies) | 'ticket' (thermal printer)
    reminder_days: 15, // a pending repair older than this is listed as forgotten
    // Placeholders: {nombre} {terminal} {numero} {importe} {tienda}
    ready_message: 'Hola {nombre}, tu {terminal} ya está listo para recoger en {tienda}. Resguardo n.º {numero}.',
  },
  purchases: {
    prefix: 'C-',
    next_number: 1,
    terms: PURCHASE_TERMS,
  },
  modules: {
    invoices: true,
    repairs: true,
    stock: true,
    purchases: true,
    notices: true,
    payment_methods: true,
    files: true,
  },
  files: {
    folders: ['Facturas de proveedores', 'Contratos', 'Impuestos', 'Seguros', 'Garantías', 'Nóminas', 'Otros'],
    max_mb: 50,
  },
};

module.exports = {
  SALE_CATEGORIES, FAVORITE_CATEGORIES, EXPENSE_CATEGORIES, PALETTE, DEFAULT_SETTINGS, STARTING_NOTICES, defaultWarrantyFor,
};
