# Para quien siga este proyecto

Esto no es una introducción al código: el código se lee. Es lo que no se deduce
leyéndolo, y lo que te va a ahorrar repetir decisiones ya tomadas.

## Qué es

Una aplicación interna de FUTSALA (liga de futsal) para el ciclo 2026/2027: con qué
clubes hay que reunirse, qué se acordó en cada reunión y si el club reconfirma para el
año siguiente. Reemplaza un prototipo en AppSheet.

La usan **cinco personas**. No es un producto, no tiene clientes, no escala a miles.
Varias decisiones solo se entienden con eso en mente.

## Arrancar

```bash
node --version          # hace falta 22.5 o superior (usa node:sqlite)
npm run seed            # crea una base con datos ficticios
npm start               # http://localhost:4310
npm run acceso          # lista a quién se le puede generar un enlace
npm run acceso correo@ejemplo.com
```

**No hay dependencias.** No hay `npm install` porque no hay nada que instalar: todo sale
de los módulos de Node. Eso es deliberado (ver `DECISIONES.md`) y conviene no romperlo
sin una razón fuerte.

```bash
npm run pruebas         # 268 pruebas, sin red, base temporal propia
```

Las pruebas son el contrato. Si tocás algo y pasan todas, probablemente no rompiste
nada; si falla una, leé qué dice antes de arreglarla, porque casi todas documentan una
regla del negocio y no un detalle técnico.

## Las cinco cosas que hay que entender antes de tocar nada

**1. Las reglas viven en la base, no solo en el código.**
`server/esquema.sql` tiene restricciones y disparadores que impiden, por ejemplo,
modificar un acta aprobada o borrar el historial. No son adorno: hay pruebas que las
atacan con SQL directo. Si una regla te molesta, no la saques del servidor y listo —
está también abajo, y con razón.

**2. Nada se borra.**
No hay operación de borrado. Un plan que no va se archiva, una reunión que no se hizo se
cancela con motivo, una persona que se fue se desactiva. Las claves foráneas son
`ON DELETE RESTRICT` y el historial es de solo agregar. Cuando alguien pide "borrame
esto", casi siempre lo correcto es el equivalente que conserva el registro.

**3. El texto es el dato, no el número.**
La planilla de venta dice cosas como "Liga de Honor B / 1ra a 5ta BAFI" o "4 Categorías".
Se guarda tal cual y no se interpreta. Hubo un intento de deducir cantidades de tiras de
ese texto y fue un error: lo que se acuerda con un club se escribe en palabras, y el
número aparece recién cuando el club lo confirma. No vuelvas a deducirlo.

**4. El acta es un solo documento.**
Lo conversado, la fecha para reconfirmar y lo acordado con cada disciplina se escriben
juntos y se guardan con un botón. La reconfirmación cuelga de un acta aprobada concreta.
Si te tienta separarlo en pantallas, ya estuvo separado y se volvió atrás.

**5. La interfaz está en castellano rioplatense, y el código también.**
Nombres de funciones, variables, tablas y comentarios. No es una traducción: quienes lo
usan y quien lo pidió hablan así. Mantenelo.

## Dónde está cada cosa

| | |
|---|---|
| `server/esquema.sql` | La base y sus reglas. **Empezá por acá.** |
| `server/dominio/` | La lógica. Cada archivo es un concepto del negocio. |
| `server/web/rutas.js` | Qué dirección hace qué. |
| `server/web/paginas/` | El HTML, generado en el servidor. |
| `scripts/pruebas.js` | Las 268 pruebas, agrupadas por tema. |
| `docs/DECISIONES.md` | **Por qué** está hecho así. Leelo antes de cambiar algo grande. |
| `docs/DESPLIEGUE.md` | Cómo ponerlo en internet. |

## Lo que falta

En orden de importancia:

1. **Publicarlo** para que entren los cinco. Está todo preparado (`docs/DESPLIEGUE.md`);
   falta elegir dónde y hacerlo.
2. **Reponer el respaldo automático** apuntando al servidor. Hoy la tarea de Windows
   respalda la base local, que deja de ser la que se usa en cuanto se despliegue.
3. **Envío de los enlaces de acceso por correo.** Hoy los reparte Dirección a mano.
   Toca un solo archivo: `server/lib/entrega.js`.
4. Tres decisiones chicas sin resolver: si la fecha para reconfirmar debe ser obligatoria
   para aprobar un acta, si "Notas internas del club" merece estar a la vista, y si
   "Compromisos" se usa o se saca.
5. La columna `plan_detalle.tiras_acordadas` quedó sin nadie que la escriba.

## Cosas que te van a morder

- **SQLite en modo WAL son tres archivos.** Copiar solo `futsala.db` se lleva una parte.
  Siempre `PRAGMA wal_checkpoint(TRUNCATE)` antes. Pasó dos veces.
- **La base no puede vivir en OneDrive ni Drive.** La aplicación avisa al arrancar.
  `npm run mover-datos` la mueve bien.
- **npm se queda con los `--flag` que no reconoce.** Por eso los scripts que escriben
  piden `--aplicar` y no `--simular`: si la bandera se pierde, no pasa nada.
- **Ampliar un `CHECK` obliga a reconstruir la tabla.** Hay un ejemplo resuelto en
  `server/db.js` (`reconstruirTablas`).
- Los disparadores se crean con `IF NOT EXISTS`: cambiarle el cuerpo a uno existente no
  tendría efecto. `server/db.js` compara con el archivo y recrea los que cambiaron.

## Datos reales

El repositorio **no** trae la base, ni respaldos, ni los correos del equipo. Para trabajar
con datos de verdad hace falta que alguien de FUTSALA te pase la base; para desarrollar
alcanza con `npm run seed`.

`equipo.json` (nombres y correos reales) no se versiona: copiá `equipo.ejemplo.json`.
