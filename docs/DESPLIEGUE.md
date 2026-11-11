# Poner la aplicación en internet

Para que entren los cinco desde cualquier lado. Hay dos caminos, y la diferencia es si
existe una máquina que quede prendida.

## Camino A: Cloudflare Tunnel (si hay una máquina que queda prendida)

La aplicación sigue corriendo en esa máquina y Cloudflare la publica en internet con
HTTPS y dominio propio. **Es gratis** y no abre ningún puerto del firewall: el túnel sale
desde adentro, nadie entra desde afuera.

Qué hace falta:

1. El dominio ya administrado en Cloudflare (el que usan hoy).
2. Instalar `cloudflared` en esa máquina y crear un túnel que apunte a
   `http://localhost:4310`.
3. Dejar el túnel y la aplicación como servicios que arrancan solos.

La aplicación ya viene preparada: con `FUTSALA_PROXY=1` toma el dominio real de la
cabecera `Host` que Cloudflare conserva, el `X-Forwarded-Proto` para saber que fue
HTTPS, y `CF-Connecting-IP` para contar los intentos de acceso por persona y no por
túnel. Probado con esas cabeceras exactas.

**Lo que no resuelve:** si esa máquina se apaga, la aplicación no está. Cloudflare
publica lo que haya del otro lado del túnel, no lo reemplaza.

**Lo que conviene sumar:** Cloudflare Access adelante, para que solo los correos del
equipo lleguen siquiera a ver la pantalla de acceso.

## Camino B: un servidor propio (si no hay máquina que quede prendida)

## Lo que hace falta conseguir

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

El `Dockerfile` ya deja puestas `FUTSALA_PUBLICO=1`, `FUTSALA_PROXY=1` y `FUTSALA_DATOS=/datos`.

## Qué pasa al arrancar en modo público

- **No arranca si falta configuración.** Sin `FUTSALA_SECRETO` o sin `FUTSALA_PROXY=1`
  sale con error y dice qué falta. Un servidor expuesto mal configurado es peor que uno
  que no arranca, porque parece que anda.
- **Los enlaces de acceso salen con el dominio real y en HTTPS**, tomados de lo que
  informa el proxy. Se le cree al proxy solo porque se declaró que hay uno: si no,
  cualquiera podría mandar esas cabeceras y desviar el enlace de otra persona.
- **La cookie de sesión va marcada `Secure`**, así el navegador no la manda nunca por una
  conexión sin cifrar.
- **La pantalla de acceso tiene freno**: 10 pedidos por minuto por procedencia, y 3
  enlaces sin usar por persona. Contesta siempre lo mismo, así que quien la golpee no
  averigua ni quién tiene cuenta ni que existe un límite.

## Llevar los datos

La base que hoy está en `C:\FUTSALA\datos\futsala.db` se sube una sola vez al disco del
servidor. Después, el que manda es el servidor: la copia local queda como referencia.

Conviene hacerlo **con la aplicación local parada**, para que el archivo esté completo
(el respaldo diario ya vuelca el WAL antes de copiar; `exportaciones/respaldos/` tiene
una copia verificada de cada día).

## Respaldos, una vez en el servidor

La tarea de Windows respalda la base **local**, que después del traslado deja de ser la
que se usa. Hay que rehacerla contra el servidor: lo más simple es una tarea que baje la
base del servidor a `exportaciones/respaldos/` con la misma rotación y la misma
verificación que hace `scripts/respaldo.js` hoy.

Queda pendiente hasta que el servidor exista, porque depende de cómo se acceda a él.
