# Instalar en la Raspberry Pi 4 con umbrelOS

## Por qué no se hace por SSH

umbrelOS tiene el sistema **inmutable**: todo lo que instalas o cambias por SSH (paquetes, Node.js, servicios) se borra al reiniciar. Lo que **sí se conserva** son las **apps de Umbrel** (contenedores Docker) y sus datos en `/home/umbrel/umbrel/app-data/`.

Por eso vamos a instalar Movil City como **una app más de Umbrel**, desde **tu propia tienda de apps comunitaria** (un repositorio de GitHub). Ventajas:

- Aparece en la pantalla de inicio de Umbrel con su icono, como cualquier otra app.
- Sobrevive a reinicios y a actualizaciones de umbrelOS.
- Entra en las copias de seguridad de Umbrel.
- Para actualizarla, pulsas "Actualizar" en Umbrel.
- **No hace falta SSH en ningún paso.**

```
Tu ordenador ──git push──▶ GitHub ──construye imagen (arm64)──▶ ghcr.io
                                                                  │
Umbrel (Pi 4) ◀── App Store comunitaria lee tu repo ──────────────┘ descarga la imagen
```

Tiempo total: ~30 minutos la primera vez.

---

## Parte A · En tu ordenador (una sola vez)

Necesitas: una cuenta de GitHub y `git` instalado.

### 1. Crea el repositorio en GitHub
1. En github.com → **New repository**.
2. Nombre: **`movilcity`** (exactamente así; si usas otro, cámbialo también en `atik-movilcity/umbrel-app.yml`).
3. Visibilidad: **Public**. Umbrel tiene que poder leerlo sin contraseña.
   - Tranquilo: en GitHub solo va el **código**. Tus ventas, facturas, archivos y contraseñas se quedan en la Pi (`.gitignore` impide subir la carpeta `data/`).
4. No marques "Add README". Pulsa **Create repository**.

### 2. Pon tu usuario de GitHub en los ficheros
Descomprime el zip, abre una terminal en la carpeta `movilcity-ventas` y ejecuta (cambia `TU_USUARIO`):
```bash
bash scripts/set-github-user.sh TU_USUARIO
```
En Windows, ejecútalo desde **Git Bash**.

### 3. Sube el código
```bash
git init
git add -A
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/movilcity-ventas.git
git push -u origin main
```

### 4. Construye la imagen para la Raspberry Pi
```bash
git tag v1.1.0
git push origin v1.1.0
```
Ve a tu repositorio → pestaña **Actions**: verás "Publicar imagen Docker" en marcha. Tarda **3-5 minutos**. Espera a que salga el **check verde ✔**.

> Si falla con un error de permisos: en el repo → **Settings → Actions → General → Workflow permissions** → marca **Read and write permissions** → Save. Luego, en Actions, pulsa **Re-run jobs**.

### 5. Haz pública la imagen (importante)
GitHub crea la imagen como **privada**, y Umbrel no podría descargarla.
1. Ve a tu perfil de GitHub → pestaña **Packages** → **movilcity-ventas**.
2. **Package settings** (abajo a la derecha) → **Change visibility** → **Public** → confirma escribiendo el nombre.

---

## Parte B · En Umbrel (desde el navegador, sin SSH)

### 6. Añade tu tienda de apps
1. Abre **http://umbrel.local** e inicia sesión.
2. Entra en **App Store**.
3. Pulsa el botón de **los tres puntos (⋯)** arriba a la derecha → **Community App Stores**.
4. Pega `https://github.com/TU_USUARIO/movilcity-ventas` → **Add**.
5. Aparecerá **"Atik App Store"**. Ábrela.

### 7. Instala la app
1. Pulsa **Movil City Ventas** → **Install**. La primera vez tarda un poco porque descarga la imagen (~60 MB).
2. Cuando termine, ábrela desde la pantalla de inicio o en **http://umbrel.local:4747**.

### 8. Configuración inicial (dentro de la app)
1. **Crear la cuenta del administrador** (tú). Usa una contraseña distinta de la de Umbrel.
2. **Ajustes → Tienda**: nombre comercial, **nombre y apellidos del titular**, **NIF**, dirección y logo. Aparecerán en todos los PDF.
3. **Ajustes → Tickets y facturas**: revisa las series. Si ya usabas facturas, pon en "Próximo número de factura" el siguiente al último que hiciste.
4. **Ajustes → Usuarios**: crea un usuario con PIN para cada trabajador.
5. **Ajustes → Permisos**: decide qué ve el trabajador.

### 9. Úsala en la tienda
- Desde cualquier móvil, tablet u ordenador **conectado a la misma WiFi**: **http://umbrel.local:4747**
  - Si `umbrel.local` no funciona (pasa en algunos Android), usa la IP: **http://192.168.X.X:4747**. La ves en Umbrel → Settings.
- En el móvil, "Añadir a pantalla de inicio" para tenerla como una app.
- Los trabajadores **no necesitan la contraseña de Umbrel**: la app tiene su propio inicio de sesión y solo ven lo que permitas.

> Consejo: en tu router, reserva una IP fija para la Raspberry Pi para que la dirección no cambie nunca.

---

## Actualizar la app cuando hagas cambios

El flujo de trabajo recomendado:

1. **Prueba los cambios en tu ordenador**, no en la Pi. Instala Node.js 22 o superior y ejecuta:
   ```bash
   npm run demo     # con datos de ejemplo → http://localhost:3001
   npm start        # base de datos vacía   → http://localhost:3000
   ```
   Los cambios en `public/` se ven al recargar el navegador; los de `server.js` o `src/` necesitan reiniciar con Ctrl+C y `npm start`.
2. Cuando funcione, publica una versión nueva:
   ```bash
   bash scripts/release.sh 1.2.0
   ```
   Este script cambia el número de versión en todos los ficheros, hace commit, crea la etiqueta y lo sube a GitHub.
3. Espera el **check verde** en Actions (3-5 min).
4. En Umbrel → **App Store** → aparecerá **Update** en Movil City Ventas. Si no aparece aún, recarga la página o espera unos minutos.

Tus datos **no se pierden** al actualizar: están fuera del contenedor.

> Cada versión nueva necesita un número mayor (1.2.0, 1.2.1, 1.3.0…). Umbrel solo ofrece actualizar si el número cambia.

---

## Copias de seguridad
- **En Umbrel:** Settings → **Backups**. Incluye la base de datos y la carpeta de archivos de la tienda.
- **Desde la app:** Ajustes → Datos y copias → **Descargar copia (.db)**. Guárdala fuera de la Pi una vez por semana: la tarjeta SD puede fallar. Esta copia no incluye los archivos subidos en "Archivos".
- La app también guarda una copia diaria automática de la base de datos (últimos 30 días) dentro de sus datos.

## Acceder desde fuera de la tienda
Instala **Tailscale** desde la **App Store oficial de Umbrel** y también en tu móvil. Entrarás a `http://umbrel:4747` desde cualquier sitio, sin abrir puertos del router. No expongas el puerto 4747 a internet.

## Memoria (Pi 4 de 2 GB)
La app usa unos 40-60 MB de RAM. El límite lo marcan las demás apps de Umbrel: si tienes muchas (sobre todo un nodo de Bitcoin), revisa el uso de memoria en Umbrel → Settings.

---

## Plan B: sin GitHub, con Portainer
Solo si la tienda comunitaria te da problemas. Es menos cómodo: la app no aparece en la pantalla de inicio y, **si desinstalas Portainer, se borran la app y sus datos**.

1. Haz igualmente los pasos 1-5 (la imagen tiene que estar publicada).
2. Umbrel → App Store → instala **Portainer**.
3. En Portainer: **Stacks → Add stack** → pega el contenido de `docker-compose.yml` (el de la raíz del proyecto, que usa un *volumen con nombre*, como pide Umbrel) → **Deploy**.
4. Abre **http://umbrel.local:4747**.

---

## Problemas frecuentes

| Problema | Solución |
|---|---|
| Umbrel dice que no puede descargar la imagen | La imagen sigue privada (paso 5) o Actions no terminó en verde (paso 4) |
| La tienda comunitaria no aparece | Revisa que el repo sea **público** y que `umbrel-app-store.yml` esté en la raíz |
| No sale "Update" tras publicar | Comprueba que cambió la versión en `atik-movilcity/umbrel-app.yml` y recarga la App Store |
| `umbrel.local` no abre en un móvil | Usa la IP de la Pi: `http://192.168.X.X:4747` |
| He olvidado la contraseña del administrador | Si hay otro administrador, puede cambiarla en Ajustes → Usuarios. Si no: Umbrel → **Settings → Advanced settings → Terminal**, elige la app **Movil City Ventas** y ejecuta `node scripts/reset-password.js TU_USUARIO NuevaClave` |
