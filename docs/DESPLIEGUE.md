# Poner la aplicación en internet

Para que entren los cinco desde cualquier lado. Hay dos caminos, y la diferencia es si
existe una máquina que quede prendida. **El elegido es el A** (11/11/2026).

## Camino A: Cloudflare Tunnel (si hay una máquina que queda prendida)

La aplicación sigue corriendo en esa máquina y Cloudflare la publica en internet con
HTTPS y dominio propio. **Es gratis** y no abre ningún puerto del firewall: el túnel sale
desde adentro, nadie entra desde afuera.

**Lo que no resuelve:** si esa máquina se apaga, la aplicación no está. Cloudflare
publica lo que haya del otro lado del túnel, no lo reemplaza.

### Cómo queda armado

```
navegador ──HTTPS──> Cloudflare ──túnel──> cloudflared ──> 127.0.0.1:4310 (la aplicación)
                                           └──── las dos en la máquina de FUTSALA ────┘
```

- La aplicación escucha **solo en 127.0.0.1**. Nadie de la red local le habla
  directamente: si pudiera, le podría mandar cabeceras de proxy inventadas y desviar un
  enlace de acceso. `npm run tunel` no arranca si no está así.
- La base **sigue en esa misma máquina**, donde está hoy. No hay que mudarla.
- La configuración vive en `.env` en la raíz del proyecto (no se versiona: tiene el
  secreto de las sesiones).

### Paso a paso

Todo en la máquina que queda prendida, con la aplicación ya instalada y andando ahí.

**1. Que no se duerma.** Configuración > Sistema > Energía: con corriente, "Suspender"
en **Nunca**. Si se suspende, la aplicación desaparece de internet hasta que alguien la
toque.

**2. Elegir el dominio.** Un subdominio del dominio que ya está en Cloudflare, por
ejemplo `reuniones.<dominio>`.

**3. Preparar la aplicación** (una sola vez):

```bash
npm run preparar-tunel reuniones.<dominio>
npm run tunel
```

El primero escribe `.env`. El segundo arranca la aplicación como va a quedar; dejala
abierta para el paso 5 y cerrala (Ctrl+C) al terminar.

**4. Crear el túnel en Cloudflare.** En el panel: Zero Trust > Networks > Tunnels >
*Create a tunnel* > Cloudflared. Ponerle de nombre `futsala`, elegir Windows y copiar el
comando que muestra (`cloudflared.exe service install <token>`). Correrlo en una
PowerShell **como administrador**: instala cloudflared como servicio de Windows, que
arranca solo con la máquina.

> Si esa máquina ya tiene cloudflared corriendo para otra cosa, no instales un segundo
> servicio: agregá el dominio al túnel que ya existe (paso 5 sobre ese túnel).

**5. Apuntar el dominio a la aplicación.** En el mismo túnel, *Public Hostname* > *Add*:

| Campo | Valor |
|---|---|
| Subdomain | `reuniones` |
| Domain | el dominio |
| Type | `HTTP` |
| URL | `127.0.0.1:4310` |

Va `127.0.0.1` y no `localhost`: en Windows `localhost` puede resolver primero a la
dirección IPv6, donde la aplicación no escucha.

Abrir `https://reuniones.<dominio>` desde un teléfono **con los datos móviles** (no por
el wifi de la oficina): tiene que aparecer la pantalla de FUTSALA.

**6. Dejarlo fijo.** Cerrar el `npm run tunel` del paso 3 y, en PowerShell como
administrador:

```bash
powershell -ExecutionPolicy Bypass -File scripts\instalar-tareas.ps1
```

Registra dos tareas que corren aunque nadie inicie sesión:

- **FUTSALA servidor**: arranca la aplicación al prender la máquina y la vuelve a
  levantar a los 30 segundos si se cae.
- **FUTSALA respaldo**: el respaldo diario verificado (23:30; se cambia con
  `-HoraRespaldo 03:00`).

Para no esperar a reiniciar: `Start-ScheduledTask -TaskName 'FUTSALA servidor'`.

Si la máquina ya tenía una tarea de respaldo de FUTSALA con otro nombre, desactivala:
dos respaldos no rompen nada, pero ocupan el doble.

**7. Repartir los enlaces.** Igual que hasta ahora, `npm run acceso <correo>` en esa
máquina. Con `.env` presente, el enlace sale con el dominio público y en HTTPS.

### Para revisar que anda

| Qué | Dónde |
|---|---|
| Qué dijo la aplicación al arrancar, y si se cayó | `servidor.log`, junto a la base |
| Los enlaces de acceso generados | `enlaces-de-acceso.log`, junto a la base |
| Si el túnel está conectado | Zero Trust > Networks > Tunnels: tiene que decir *Healthy* |
| Los respaldos | `npm run respaldo -- --ver` |

`servidor.log` va junto a la base y no en `exportaciones/` porque muestra los enlaces de
acceso, y `exportaciones/` se sincroniza.

### Lo que conviene sumar, y hay que decidir antes

**Cloudflare Access adelante**, para que solo los correos del equipo lleguen siquiera a
ver la pantalla de acceso. Es gratis hasta 50 personas: Zero Trust > Access >
Applications > *Self-hosted*, el mismo dominio, y una política *Allow* con los cinco
correos y el método *One-time PIN*.

**No está activado, y no se activa sin que Facundo lo autorice:** con *One-time PIN*,
Cloudflare le manda un código por correo a cada persona cada vez que entra. No lo manda
la aplicación, pero es un mensaje que le llega a alguien, y hasta hoy no se mandó
ninguno. Sin Access la aplicación sigue protegida por los enlaces de un solo uso y el
freno de la pantalla de acceso; Access suma una puerta más adelante.

## Camino B: un servidor propio (si no hay máquina que quede prendida)

No es el elegido; queda documentado por si la máquina deja de ser una opción.

### Lo que hace falta conseguir

**Una cuenta en un proveedor que acepte un Dockerfile y dé un disco persistente.**
Fly.io, Railway y Render sirven. Cuestan entre 3 y 7 dólares por mes, y los tres dan un
subdominio con HTTPS incluido, así que no hace falta comprar dominio.

Eso es lo único que no se puede preparar de antemano: hay que crear la cuenta y poner
una tarjeta. El resto ya está listo en este repositorio.

**Lo imprescindible del proveedor, sea cual sea:**

| | Por qué |
|---|---|
| Disco persistente montado en `/datos` | Sin esto la base se borra en cada despliegue. Es el error clásico con SQLite. |
| HTTPS en el dominio | La aplicación va por HTTP detrás del proxy; el cifrado lo pone el proveedor. |
| Variable secreta `FUTSALA_SECRETO` | Firma las sesiones. Tiene que ser larga, al azar y **siempre la misma**: si cambia, todos quedan afuera. |
| Variables `FUTSALA_FIREBASE_*` (optativas) | API key, auth domain, project id y app id del proyecto Firebase. Sin ellas no aparece el botón de Google. El dominio público tiene que figurar en Firebase → Authentication → Settings → Authorized domains. |

El `Dockerfile` ya deja puestas `FUTSALA_PUBLICO=1`, `FUTSALA_PROXY=1` y `FUTSALA_DATOS=/datos`.
Ahí la aplicación escucha en todas las interfaces, porque el proxy del proveedor está en
otra máquina.

### Llevar los datos

La base que hoy está en `C:\FUTSALA\datos\futsala.db` se sube una sola vez al disco del
servidor. Después, el que manda es el servidor: la copia local queda como referencia.

Conviene hacerlo **con la aplicación local parada**, para que el archivo esté completo
(el respaldo diario ya vuelca el WAL antes de copiar; `exportaciones/respaldos/` tiene
una copia verificada de cada día).

### Respaldos en ese caso

La tarea de Windows respalda la base **local**, que después del traslado deja de ser la
que se usa. Habría que rehacerla contra el servidor: una tarea que baje la base a
`exportaciones/respaldos/` con la misma rotación y verificación que `scripts/respaldo.js`.
Con el camino A no hace falta: la base no se mueve.

## Qué pasa al arrancar en modo público (los dos caminos)

- **No arranca si falta configuración.** Sin `FUTSALA_SECRETO` o sin `FUTSALA_PROXY=1`
  sale con error y dice qué falta. Con el túnel, además, exige escuchar solo en
  127.0.0.1 y tener la dirección pública. Un servidor expuesto mal configurado es peor
  que uno que no arranca, porque parece que anda.
- **Los enlaces de acceso salen con el dominio real y en HTTPS**, tomados de lo que
  informa el proxy. Se le cree al proxy solo porque se declaró que hay uno: si no,
  cualquiera podría mandar esas cabeceras y desviar el enlace de otra persona. Con
  Cloudflare, `CF-Connecting-IP` da la dirección real de quien pide, para contar los
  intentos por persona y no por túnel.
- **La cookie de sesión va marcada `Secure`**, así el navegador no la manda nunca por una
  conexión sin cifrar.
- **La pantalla de acceso tiene freno**: 10 pedidos por minuto por procedencia, y 3
  enlaces sin usar por persona. Contesta siempre lo mismo, así que quien la golpee no
  averigua ni quién tiene cuenta ni que existe un límite.
