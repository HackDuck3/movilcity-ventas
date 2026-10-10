# Copias de seguridad fuera del servidor

La aplicación guarda cada día una copia de la base de datos en `data/backups`, pero esa copia vive en el mismo disco que los datos. Si el disco falla, o roban o se quema el equipo, se pierde todo a la vez. Esta guía deja una copia **cifrada** en otro ordenador y, de paso, en la nube.

## Qué es la copia completa

Un único archivo `.mcbackup` con todo lo necesario para reconstruir la tienda:

- `ventas.db`: ventas, documentos, reparaciones, clientes, stock y ajustes.
- `files/`: los archivos subidos a la sección Archivos.
- `id-documents/`: las fotos de documentos de identidad de las compras.

Va cifrado con AES-256 y una contraseña que eliges tú. Quien consiga el archivo sin la contraseña no puede leer nada, así que se puede guardar en un disco externo o en una carpeta sincronizada con la nube.

> **La contraseña no se puede recuperar.** Apúntala en papel o en un gestor de contraseñas, en un sitio que no sea el propio servidor. Sin ella, las copias no sirven.

## 1. Poner la contraseña

En *Ajustes → Datos y copias → Copia completa cifrada*, escribe una contraseña de al menos 10 caracteres y pulsa **Guardar contraseña**.

Desde ese momento, **Descargar copia completa** baja el archivo cuando quieras. Para una copia manual de vez en cuando, con esto basta.

## 2. Copia automática en otro ordenador

La aplicación no envía nada por su cuenta: es el otro ordenador el que viene a buscar la copia. Así el servidor no necesita contraseñas de ningún servicio externo.

En el ordenador que va a guardar las copias (un Mac o un Linux que llegue a la aplicación, por la red local o por Tailscale):

1. Copia a ese ordenador el archivo [`scripts/fetch-backup.sh`](../scripts/fetch-backup.sh), por ejemplo a `~/fetch-backup.sh`.
2. Crea el archivo `~/.movilcity-backup.env` con la dirección de la aplicación y el token que aparece en *Ajustes → Datos y copias*:

   ```bash
   APP_URL=http://DIRECCION-DE-LA-APP:4747
   BACKUP_TOKEN=pega-aqui-el-token
   BACKUP_DIR="$HOME/Copias Movil City"
   KEEP=30
   ```

3. Protege ese archivo y prueba el script una vez:

   ```bash
   chmod 600 ~/.movilcity-backup.env
   ```

   ```bash
   bash ~/fetch-backup.sh
   ```

   Debe aparecer `copia guardada: …` y el archivo en la carpeta.

4. Prográmalo a diario. Abre el programador de tareas:

   ```bash
   crontab -e
   ```

   Y añade esta línea (todos los días a las 14:00; elige una hora a la que el ordenador suela estar encendido):

   ```
   0 14 * * * /bin/bash $HOME/fetch-backup.sh >> $HOME/movilcity-backup.log 2>&1
   ```

   En macOS, la primera vez puede pedir permiso para que `cron` acceda a la carpeta de destino.

En *Ajustes → Datos y copias* se ve cuándo fue la última vez que otro equipo se llevó la copia, y avisa si han pasado tres días o más.

## 3. Que la copia salga de casa

Si el otro ordenador está en la misma casa que el servidor, un robo o un incendio se lleva los dos. Para evitarlo, pon `BACKUP_DIR` dentro de una carpeta sincronizada con la nube. Como el archivo ya va cifrado, el proveedor no puede leerlo:

```bash
BACKUP_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Copias Movil City"
```

Ese ejemplo es iCloud Drive en un Mac; sirve igual la carpeta de Google Drive, Dropbox o OneDrive.

## Restaurar una copia

En cualquier ordenador con Node.js 22.13 o superior y el código de la aplicación:

```bash
node scripts/restore-backup.js movilcity-2026-10-10.mcbackup carpeta-restaurada
```

Pide la contraseña y deja en `carpeta-restaurada` la base de datos y las dos carpetas de archivos. Para ponerla en marcha:

1. Detén la aplicación.
2. Sustituye el contenido de su carpeta de datos (`data/`, o el volumen `/data` en Docker y Umbrel) por el de `carpeta-restaurada`. Borra `ventas.db-wal` y `ventas.db-shm` si existen.
3. Arranca la aplicación.

**Prueba a restaurar una copia al menos una vez**, antes de necesitarla: una copia que nunca se ha abierto no es una copia comprobada.

## Si se filtra el token

El token solo permite descargar la copia cifrada, no entrar en la aplicación. Aun así, si crees que alguien lo tiene, pulsa **Cambiar el token** en Ajustes y actualiza `~/.movilcity-backup.env`.
