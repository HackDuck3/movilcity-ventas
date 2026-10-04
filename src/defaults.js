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
    show_vat: true,
    vat_rate: 21,
    color_shop: '#6c63e6',
    color_title: '#283593',
    color_accent: '#e91e63',
    ticket_format: 'ticket', // 'ticket' (80 mm) | 'a4'
  },
  modules: {
    invoices: true,
    payment_methods: true,
    files: true,
  },
  files: {
    folders: ['Facturas de proveedores', 'Contratos', 'Impuestos', 'Seguros', 'Garantías', 'Nóminas', 'Otros'],
    max_mb: 50,
  },
};

module.exports = { SALE_CATEGORIES, FAVORITE_CATEGORIES, EXPENSE_CATEGORIES, PALETTE, DEFAULT_SETTINGS, defaultWarrantyFor };
