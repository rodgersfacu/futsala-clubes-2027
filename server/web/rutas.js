import { todos, uno, enTransaccion, RUTA_DB } from '../db.js';
import * as auth from '../auth.js';
import { ErrorNegocio, ErrorNoEncontrado, ErrorPermiso } from '../lib/errores.js';
import { hoy, fechaCorta, lunesDe, domingoDe, sumarDias, mesDe } from '../lib/fechas.js';
import * as entrega from '../lib/entrega.js';

import * as usuarios from '../dominio/usuarios.js';
import * as clubes from '../dominio/clubes.js';
import * as planes from '../dominio/planes.js';
import * as reuniones from '../dominio/reuniones.js';
import * as compromisos from '../dominio/compromisos.js';
import * as reconfirmaciones from '../dominio/reconfirmaciones.js';
import * as conflictos from '../dominio/conflictos.js';
import * as accesos from '../dominio/accesos.js';
import * as disponibilidad from '../dominio/disponibilidad.js';
import * as consultas from '../dominio/consultas.js';
import * as exportar from '../dominio/exportar.js';

import * as paginaInicio from './paginas/inicio.js';
import * as paginaClubes from './paginas/clubes.js';
import * as paginaClub from './paginas/club.js';
import * as paginaAgenda from './paginas/agenda.js';
import * as paginaReunion from './paginas/reunion.js';
import * as paginaCompromisos from './paginas/compromisos.js';
import * as paginaReconfirmacion from './paginas/reconfirmacion.js';
import * as paginaAdmin from './paginas/admin.js';
import * as paginaImprimir from './paginas/imprimir.js';
import * as paginaDisponibilidad from './paginas/disponibilidad.js';
import * as paginaAcerca from './paginas/acerca.js';
import * as varias from './paginas/varias.js';

const CICLO = consultas.CICLO;

/** Tabla de rutas. El primer patrón que coincide atiende el pedido. */
export const rutas = [
  ['GET', '/', verInicio],
  ['GET', '/sesion', verSesion],
  ['POST', '/sesion', pedirAcceso],
  ['GET', '/entrar/:token', verEntrar],
  ['POST', '/entrar', entrar],
  ['POST', '/sesion/salir', salir],

  ['GET', '/clubes', verClubes],
  ['POST', '/clubes', crearClub],
  ['GET', '/clubes/:id', verClub],
  ['GET', '/clubes/:id/imprimir', imprimirClub],
  ['POST', '/clubes/:id', editarClub],
  ['POST', '/clubes/:id/plan', crearPlan],

  ['POST', '/planes/:id/cerrar', accionPlan(planes.cerrar)],
  ['POST', '/planes/:id/archivar', accionPlan(planes.archivar)],
  ['POST', '/planes/:id/reabrir', accionPlan(planes.reabrirPlan)],
  ['POST', '/planes/:id/detalles', agregarDisciplina],
  ['POST', '/detalles/:id', editarDisciplina],
  ['POST', '/planes/:id/reuniones', crearReunion],
  ['POST', '/planes/:id/reconfirmacion', crearReconfirmacion],

  ['GET', '/agenda', verAgenda],
  ['GET', '/disponibilidad', verDisponibilidad],
  ['POST', '/disponibilidad/franjas', agregarFranja],
  ['POST', '/disponibilidad/franjas/:id/quitar', quitarFranja],
  ['POST', '/disponibilidad/ausencias', agregarAusencia],
  ['POST', '/disponibilidad/ausencias/:id/quitar', quitarAusencia],
  ['GET', '/reuniones/:id', verReunion],
  ['POST', '/reuniones/:id/agenda', accionReunion(reuniones.editarAgenda)],
  ['POST', '/reuniones/:id/programar', accionReunion(reuniones.programar)],
  ['POST', '/reuniones/:id/realizada', accionReunion(reuniones.marcarRealizada)],
  ['POST', '/reuniones/:id/cancelar', accionReunion(reuniones.cancelar)],
  ['POST', '/reuniones/:id/acta', guardarActa],
  ['POST', '/reuniones/:id/nota', guardarNota],
  ['POST', '/reuniones/:id/acta/enviar', accionReunion(reuniones.enviarActaARevision)],
  ['POST', '/reuniones/:id/acta/devolver', accionReunion(reuniones.devolverActa)],
  ['POST', '/reuniones/:id/acta/aprobar', accionReunion(reuniones.aprobarActa)],
  ['POST', '/reuniones/:id/acta/reabrir', accionReunion(reuniones.reabrirActa)],
  ['POST', '/reuniones/:id/compromisos', crearCompromiso],

  ['GET', '/compromisos', verCompromisos],
  ['POST', '/compromisos/:id', accionCompromiso(compromisos.editar)],
  ['POST', '/compromisos/:id/iniciar', accionCompromiso(compromisos.iniciar)],
  ['POST', '/compromisos/:id/cumplir', accionCompromiso(compromisos.cumplir)],
  ['POST', '/compromisos/:id/cancelar', accionCompromiso(compromisos.cancelarTarea)],

  ['GET', '/reconfirmacion', verColaReconfirmacion],
  ['GET', '/reconfirmacion/:id', verFichaReconfirmacion],
  ['POST', '/reconfirmacion/:id/contacto', accionFicha(reconfirmaciones.registrarContacto)],
  ['POST', '/reconfirmacion/:id/condicional', accionFicha(reconfirmaciones.registrarCondicional)],
  ['POST', '/reconfirmacion/:id/sin-respuesta', accionFicha(reconfirmaciones.registrarSinRespuesta)],
  ['POST', '/reconfirmacion/:id/reprogramar', reprogramarReconfirmacion],
  ['POST', '/reconfirmacion/:id/confirmar', confirmarResultado('Confirmado')],
  ['POST', '/reconfirmacion/:id/no-continua', confirmarResultado('No continua')],
  ['POST', '/reconfirmacion/:id/reabrir', accionFicha(reconfirmaciones.reabrir)],

  ['GET', '/historial', verHistorial],
  ['GET', '/indicadores/:clave', verIndicador],

  ['GET', '/admin', verAdmin],
  ['POST', '/admin/usuarios', crearUsuario],
  ['POST', '/admin/usuarios/:id', cambiarAcceso],
  ['POST', '/admin/usuarios/:id/acceso', generarAcceso],
  ['POST', '/admin/usuarios/:id/acceso/anular', anularAcceso],
  ['POST', '/admin/parametros', guardarParametros],
  ['POST', '/admin/conflictos/:id/resolver', resolverConflicto],

  ['GET', '/exportar', verExportar],
  ['GET', '/exportar/json', descargarJson],
  ['GET', '/exportar/csv/:tabla', descargarCsv],

  ['GET', '/acerca', verAcerca],
];

// --- Helpers comunes ---------------------------------------------------------

/** Años que se ofrecen al agendar: el del cierre y el del ciclo. */
function aniosParaAgendar() {
  const p = usuarios.parametros();
  const base = p ? p.anio_cierre : new Date().getFullYear();
  return [base, base + 1];
}

function listasDeUsuarios() {
  return {
    usuariosActivos: usuarios.activos(),
    directoresActivos: usuarios.activos('Direccion'),
  };
}

function soloLectura(ctx) {
  // Todas las pantallas de consulta exigen una sesión activa: un usuario inactivo
  // o sin identidad no accede a la información del ciclo.
  auth.exigirActivo(ctx.usuario);
}

// --- Inicio y sesión ---------------------------------------------------------

function verInicio(ctx) {
  soloLectura(ctx);
  return {
    html: paginaInicio.render({ ...ctx, datos: consultas.inicio(ctx.usuario) }),
  };
}

function verSesion(ctx) {
  return {
    html: varias.sesion({
      ...ctx,
      datos: {
        minutos: accesos.MINUTOS_VALIDO,
        comoLlega: entrega.comoLlega(),
        local: entrega.soloEnEstaMaquina(),
      },
    }),
  };
}

/**
 * Alguien pide su enlace. La respuesta es siempre la misma, exista o no ese correo: si
 * contestara distinto, esta pantalla serviría para averiguar quién tiene cuenta.
 */
function pedirAcceso(ctx) {
  // Mismo texto que cuando el correo no existe: quien golpea la pantalla no se entera de
  // nada, ni de que existe un límite.
  if (accesos.demasiadosPedidos(procedenciaDe(ctx))) {
    return { redirect: '/sesion', aviso: { tono: 'info', texto: respuestaDePedido(), ayuda: entrega.comoLlega() } };
  }
  const pedido = accesos.solicitar(ctx.cuerpo.email);
  if (pedido) {
    entrega.entregar({
      usuario: pedido.usuario,
      enlace: accesos.enlaceDe(pedido.token, baseDe(ctx)),
      expiraEn: pedido.expiraEn,
    });
  }
  return {
    redirect: '/sesion',
    aviso: {
      tono: 'info',
      texto: respuestaDePedido(),
      ayuda: entrega.comoLlega(),
    },
  };
}

function verEntrar(ctx) {
  const token = ctx.params.token;
  return {
    html: varias.entrar({
      ...ctx,
      datos: { token, valido: accesos.leer(token), minutos: accesos.MINUTOS_VALIDO },
    }),
  };
}

function entrar(ctx) {
  const usuario = accesos.usar(ctx.cuerpo.token);
  return {
    redirect: '/',
    cookies: [auth.cookieSesion(usuario.id, { seguro: auth.origenDe(ctx.req).seguro })],
    aviso: { tono: 'exito', texto: `Entraste como ${usuario.nombre}.` },
  };
}

function salir() {
  return { redirect: '/sesion', cookies: [auth.cookieSalir()], aviso: { tono: 'info', texto: 'Cerraste la sesión.' } };
}

/** Lo único que contesta la pantalla de acceso, pase lo que pase del otro lado. */
function respuestaDePedido() {
  return 'Listo. Si ese correo es de alguien del equipo, su enlace ya está generado.';
}

/**
 * De dónde viene el pedido, para contarlos. Detrás de un proxy la dirección del socket
 * es la del proxy y sería la misma para todos, así que ahí se usa la que el proxy
 * informa; se le cree solo porque se declaró que hay uno.
 */
function procedenciaDe(ctx) {
  if (process.env.FUTSALA_PROXY === '1') {
    const cabeceras = ctx.req?.headers || {};
    // Cloudflare pone la dirección real en CF-Connecting-IP, y a diferencia de
    // X-Forwarded-For no se le puede agregar nada por delante: la reescribe siempre.
    const deCloudflare = String(cabeceras['cf-connecting-ip'] || '').trim();
    if (deCloudflare) return deCloudflare;
    const reenviada = String(cabeceras['x-forwarded-for'] || '').split(',')[0].trim();
    if (reenviada) return reenviada;
  }
  return ctx.req?.socket?.remoteAddress || 'desconocida';
}

/** De dónde cuelga el enlace que se le pasa a la persona. */
function baseDe(ctx) {
  if (!ctx.req) return `http://localhost:${process.env.PORT || 4310}`;
  return auth.origenDe(ctx.req).base;
}

// --- Clubes ------------------------------------------------------------------

function verClubes(ctx) {
  soloLectura(ctx);
  const busqueda = ctx.query.get('q') || '';
  const estado = ctx.query.get('estado') || '';
  return {
    html: paginaClubes.render({
      ...ctx,
      datos: {
        clubes: clubes.listar({ busqueda, estado, anioObjetivo: CICLO }),
        busqueda,
        estado,
        ...listasDeUsuarios(),
      },
    }),
  };
}

function crearClub(ctx) {
  const club = clubes.crear(ctx.usuario, ctx.cuerpo);
  const parecidos = clubes.similares(club.nombre, club.id);
  return {
    redirect: `/clubes/${club.id}`,
    aviso: {
      tono: parecidos.length > 0 ? 'aviso' : 'exito',
      texto: `Creaste ${club.nombre}.`,
      ayuda:
        parecidos.length > 0
          ? `Atención: hay ${parecidos.length} club(es) con nombre parecido. Revisá que no sea un duplicado.`
          : 'Ahora podés crear su plan del ciclo 2026/2027.',
    },
  };
}

function verClub(ctx) {
  soloLectura(ctx);
  const datos = consultas.fichaClub(ctx.params.id, CICLO);
  if (!datos) throw new ErrorNoEncontrado('Ese club no existe.');
  return {
    html: paginaClub.render({
      ...ctx,
      datos: {
        ...datos,
        ...listasDeUsuarios(),
        similares: clubes.similares(datos.club.nombre, datos.club.id),
        aniosAgenda: aniosParaAgendar(),
        ventana: reconfirmaciones.ventana(),
      },
    }),
  };
}

/** Hoja de una carilla para llevar a la reunión: se imprime o se guarda como PDF. */
function imprimirClub(ctx) {
  soloLectura(ctx);
  const club = clubes.exigir(ctx.params.id);
  const plan = planes.porClub(club.id, CICLO);
  const proxima = plan
    ? uno(
        `SELECT m.*, d1.nombre AS director1_nombre, d2.nombre AS director2_nombre,
                ar.nombre AS acta_responsable_nombre
         FROM reunion m
         LEFT JOIN usuario d1 ON d1.id = m.director1_id
         LEFT JOIN usuario d2 ON d2.id = m.director2_id
         LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
         WHERE m.plan_id = ? AND m.estado IN ('Borrador','Programada')
         ORDER BY IFNULL(m.inicio, m.creado_en) LIMIT 1`,
        plan.id,
      )
    : null;

  return {
    html: paginaImprimir.render({
      datos: {
        club,
        plan,
        detalles: plan ? planes.detalles(plan.id) : [],
        reunion: proxima,
        ventana: reconfirmaciones.ventana(),
      },
    }),
  };
}

function editarClub(ctx) {
  const club = clubes.editar(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return { redirect: `/clubes/${club.id}`, aviso: { tono: 'exito', texto: 'Guardamos los datos del club.' } };
}

function crearPlan(ctx) {
  const plan = planes.crear(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return {
    redirect: `/clubes/${plan.club_id}`,
    aviso: {
      tono: 'exito',
      texto: `Creaste el plan ${plan.anio_cierre}/${plan.anio_objetivo}.`,
      ayuda: 'El club y los años ya quedaron fijos: la base no permite cambiarlos.',
    },
  };
}

// --- Plan --------------------------------------------------------------------

function accionPlan(operacion) {
  return (ctx) => {
    const plan = operacion(ctx.usuario, ctx.params.id, ctx.cuerpo);
    return {
      redirect: `/clubes/${plan.club_id}`,
      aviso: { tono: 'exito', texto: mensajeDeEstado(plan) },
    };
  };
}

function mensajeDeEstado(plan) {
  if (plan.estado === 'Cerrada') return 'Cerramos el plan. Su contenido queda bloqueado.';
  if (plan.estado === 'Archivada') return 'Archivamos el plan: sale de los indicadores del ciclo.';
  return 'Guardamos el cambio.';
}

function agregarDisciplina(ctx) {
  const detalle = planes.agregarDisciplina(ctx.usuario, ctx.params.id, ctx.cuerpo);
  const plan = planes.exigir(detalle.plan_id);
  return {
    redirect: `/clubes/${plan.club_id}#tiras`,
    aviso: { tono: 'exito', texto: `Agregamos la disciplina ${detalle.disciplina}.` },
  };
}

function editarDisciplina(ctx) {
  const detalle = planes.editarDisciplina(ctx.usuario, ctx.params.id, ctx.cuerpo);
  const plan = planes.exigir(detalle.plan_id);
  return {
    redirect: `/clubes/${plan.club_id}#tiras`,
    aviso: { tono: 'exito', texto: `Guardamos ${detalle.disciplina}.` },
  };
}

// --- Reuniones y actas -------------------------------------------------------

function crearReunion(ctx) {
  const reunion = reuniones.crear(ctx.usuario, ctx.params.id, ctx.cuerpo);
  const cruces = reuniones.superposiciones({ ...reunion, exceptoId: reunion.id });
  const fueraDeHorario = disponibilidad.avisoDeAgenda(reunion);
  const alertas = [
    fueraDeHorario,
    cruces.length > 0 ? 'Se superpone con otra reunión que comparte personas.' : null,
  ].filter(Boolean);
  return {
    redirect: `/reuniones/${reunion.id}`,
    aviso: {
      tono: alertas.length > 0 ? 'aviso' : 'exito',
      texto: 'Creamos la reunión en borrador.',
      ayuda: alertas.length > 0 ? `${alertas.join(' · ')} Se guardó igual.` : 'Revisá los datos y programala.',
    },
  };
}

function guardarNota(ctx) {
  const reunion = reuniones.guardarNota(ctx.usuario, ctx.params.id, ctx.cuerpo);
  // Se anota desde los dos lados: desde la ficha del club y desde la reunión. Se vuelve
  // a donde estaba quien escribió, y el club sale del plan, no del formulario.
  const plan = planes.exigir(reunion.plan_id);
  return {
    redirect:
      String(ctx.cuerpo.volver_a || '') === 'club'
        ? `/clubes/${plan.club_id}#reuniones`
        : `/reuniones/${reunion.id}`,
    aviso: { tono: 'exito', texto: reunion.nota ? 'Guardamos la observación.' : 'Borramos la observación.' },
  };
}

/**
 * El acta se guarda entera de una vez: lo que se conversó y lo que se acordó con cada
 * disciplina son el mismo documento y el mismo formulario. Van en una transacción: o
 * entra todo o no entra nada, para que no quede un acta a medias.
 */
function guardarActa(ctx) {
  const { reunion, cambiadas } = enTransaccion(() => {
    const guardada = reuniones.guardarActa(ctx.usuario, ctx.params.id, ctx.cuerpo);
    const acuerdos = reuniones.guardarAcuerdos(ctx.usuario, ctx.params.id, ctx.cuerpo);
    return { reunion: guardada, cambiadas: acuerdos.cambiadas };
  });
  return {
    redirect: `/reuniones/${reunion.id}#acta`,
    aviso: {
      tono: 'exito',
      texto: 'Guardamos el acta.',
      ayuda:
        cambiadas > 0
          ? `Lo acordado quedó registrado en ${cambiadas} disciplina(s) y se ve en la ficha del club.`
          : null,
    },
  };
}

function verReunion(ctx) {
  soloLectura(ctx);
  const reunion = reuniones.conContexto(ctx.params.id);
  if (!reunion) throw new ErrorNoEncontrado('Esa reunión no existe.');
  const esDireccion = auth.esDireccion(ctx.usuario);
  return {
    html: paginaReunion.render({
      ...ctx,
      datos: {
        reunion,
        compromisos: compromisos.porReunion(reunion.id),
        // Todas las disciplinas del plan, en el orden de la planilla: el acta se completa
        // recorriéndolas, no buscando las que alguien vinculó antes.
        disciplinas: reuniones.disciplinasParaActa(reunion.id),
        puedeEditarActa: reuniones.puedeEditarActa(ctx.usuario, reunion),
        puedeCrearCompromisos:
          esDireccion ||
          (auth.esAyudante(ctx.usuario) &&
            reunion.acta_responsable_id === ctx.usuario.id &&
            reunion.acta_estado !== 'Validada'),
        // Los ayudantes agendan y coordinan; la aprobación del acta sigue siendo de Dirección.
        puedeAgendar: auth.puedeEscribir(ctx.usuario),
        aniosAgenda: aniosParaAgendar(),
        avisoDisponibilidad: disponibilidad.avisoDeAgenda(reunion),
        franjasDirector: reunion.director1_id ? disponibilidad.franjasDe(reunion.director1_id) : [],
        plan: planes.obtener(reunion.plan_id),
        esDireccion,
        superposiciones: reuniones.superposiciones({ ...reunion, exceptoId: reunion.id }),
        ...listasDeUsuarios(),
      },
    }),
  };
}

function verDisponibilidad(ctx) {
  soloLectura(ctx);
  return {
    html: paginaDisponibilidad.render({ ...ctx, datos: { agendas: disponibilidad.porDireccion() } }),
  };
}

function agregarFranja(ctx) {
  const franja = disponibilidad.agregarFranja(ctx.usuario, ctx.cuerpo);
  return {
    redirect: '/disponibilidad',
    aviso: {
      tono: 'exito',
      texto: `Agregaste los ${disponibilidad.nombreDia(franja.dia_semana).toLowerCase()} de ${franja.desde} a ${franja.hasta}.`,
    },
  };
}

function quitarFranja(ctx) {
  disponibilidad.quitarFranja(ctx.usuario, ctx.params.id);
  return { redirect: '/disponibilidad', aviso: { tono: 'info', texto: 'Quitamos ese horario.' } };
}

function agregarAusencia(ctx) {
  disponibilidad.agregarAusencia(ctx.usuario, ctx.cuerpo);
  return {
    redirect: '/disponibilidad',
    aviso: { tono: 'exito', texto: 'Anotamos que no estás en esas fechas.' },
  };
}

function quitarAusencia(ctx) {
  disponibilidad.quitarAusencia(ctx.usuario, ctx.params.id);
  return { redirect: '/disponibilidad', aviso: { tono: 'info', texto: 'Quitamos esa ausencia.' } };
}

/**
 * Rangos que se eligen con un clic, en lugar de escribir dos fechas. El rango se
 * resuelve acá y no en la pantalla, para que el enlace que se comparte diga qué días
 * incluye y siga queriendo decir lo mismo mañana.
 */
function rangoRapido(nombre) {
  const h = hoy();
  switch (nombre) {
    case 'hoy':
      return { desde: h, hasta: h };
    case 'semana':
      return { desde: lunesDe(h), hasta: domingoDe(h) };
    case 'proxima':
      return { desde: sumarDias(lunesDe(h), 7), hasta: sumarDias(domingoDe(h), 7) };
    case 'mes':
      return mesDe(h);
    case 'porvenir':
      return { desde: h, hasta: null };
    default:
      return { desde: null, hasta: null };
  }
}

const VISTAS_AGENDA = ['dia', 'semana', 'persona', 'club'];

function verAgenda(ctx) {
  soloLectura(ctx);
  const rango = ctx.query.get('rango') || '';
  const porRango = rangoRapido(rango);
  // Un rango rápido manda sobre las fechas sueltas: es lo último que tocó quien mira.
  const desde = (rango ? porRango.desde : ctx.query.get('desde')) || null;
  const hasta = (rango ? porRango.hasta : ctx.query.get('hasta')) || null;
  const estado = ctx.query.get('estado') || '';
  const persona = ctx.query.get('persona') || '';
  const clubId = ctx.query.get('club') || '';
  const modalidad = ctx.query.get('modalidad') || '';
  const pendientesDeActa = ctx.query.get('pendientes') === '1';
  const vista = VISTAS_AGENDA.includes(ctx.query.get('vista')) ? ctx.query.get('vista') : 'dia';
  const lista = reuniones.agenda({ desde, hasta, estado, persona, clubId, modalidad, pendientesDeActa });

  // Avisos de superposición: pares de reuniones no canceladas que se cruzan y
  // comparten alguna persona. Es un aviso, no una validación que bloquee.
  const cruces = [];
  for (let i = 0; i < lista.length; i += 1) {
    for (let j = i + 1; j < lista.length; j += 1) {
      const a = lista[i];
      const b = lista[j];
      if (a.estado === 'Cancelada' || b.estado === 'Cancelada') continue;
      if (!a.inicio || !a.fin || !b.inicio || !b.fin) continue;
      if (!(a.inicio < b.fin && a.fin > b.inicio)) continue;
      const personasA = [a.director1_id, a.director2_id, a.acta_responsable_id].filter(Boolean);
      const personasB = [b.director1_id, b.director2_id, b.acta_responsable_id];
      if (personasA.some((persona) => personasB.includes(persona))) cruces.push({ a, b });
    }
  }

  return {
    html: paginaAgenda.render({
      ...ctx,
      datos: {
        reuniones: lista,
        desde: desde || '',
        hasta: hasta || '',
        estado,
        persona,
        clubId,
        modalidad,
        pendientesDeActa,
        rango,
        vista,
        cruces,
        clubesConReuniones: reuniones.clubesConReuniones(),
        hoy: hoy(),
        ...listasDeUsuarios(),
      },
    }),
  };
}

function accionReunion(operacion) {
  return (ctx) => {
    const reunion = operacion(ctx.usuario, ctx.params.id, ctx.cuerpo);
    const fueraDeHorario =
      reunion.estado === 'Programada' || reunion.estado === 'Borrador'
        ? disponibilidad.avisoDeAgenda(reunion)
        : null;
    return {
      redirect: `/reuniones/${reunion.id}`,
      aviso: {
        tono: fueraDeHorario ? 'aviso' : 'exito',
        texto: mensajeDeReunion(reunion),
        ayuda: fueraDeHorario ? `${fueraDeHorario}. Se guardó igual.` : null,
      },
    };
  };
}

function mensajeDeReunion(reunion) {
  if (reunion.acta_estado === 'Validada') return 'Aprobamos el acta. Su contenido y lo acordado que respalda quedan bloqueados.';
  if (reunion.acta_estado === 'Para revisar') return 'Enviamos el acta a revisión de Dirección.';
  if (reunion.estado === 'Cancelada') return 'Cancelamos la reunión. Queda registrada con su motivo.';
  if (reunion.estado === 'Realizada') return 'Marcamos la reunión como realizada.';
  if (reunion.estado === 'Programada') return 'La reunión quedó programada.';
  return 'Guardamos los cambios.';
}

function crearCompromiso(ctx) {
  const tarea = compromisos.crear(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return {
    redirect: `/reuniones/${tarea.reunion_id}#compromisos`,
    aviso: { tono: 'exito', texto: 'Agregamos el compromiso.' },
  };
}

// --- Compromisos -------------------------------------------------------------

function verCompromisos(ctx) {
  soloLectura(ctx);
  const filtro = ctx.query.get('filtro') || 'abiertos';
  const soloMias = ctx.query.get('mias') === '1';
  const tareas = compromisos.listar({
    filtro,
    responsableId: soloMias ? ctx.usuario.id : null,
  });
  const permisos = {};
  for (const tarea of tareas) permisos[tarea.id] = compromisos.puedeEditar(ctx.usuario, tarea);
  return {
    html: paginaCompromisos.render({
      ...ctx,
      datos: { tareas, filtro, soloMias, permisos, hoy: hoy(), ...listasDeUsuarios() },
    }),
  };
}

function accionCompromiso(operacion) {
  return (ctx) => {
    const tarea = operacion(ctx.usuario, ctx.params.id, ctx.cuerpo);
    return {
      redirect: `/compromisos#tarea-${tarea.id}`,
      aviso: { tono: 'exito', texto: 'Guardamos el compromiso.' },
    };
  };
}

// --- Reconfirmación ----------------------------------------------------------

function crearReconfirmacion(ctx) {
  const ficha = reconfirmaciones.crear(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return {
    redirect: `/reconfirmacion/${ficha.id}`,
    aviso: { tono: 'exito', texto: 'Abrimos la ficha de reconfirmación.', ayuda: 'Hay una sola ficha final por plan.' },
  };
}

function verColaReconfirmacion(ctx) {
  soloLectura(ctx);
  const filtro = ctx.query.get('filtro') || 'abiertas';
  const ventana = reconfirmaciones.ventana();
  return {
    html: paginaReconfirmacion.renderCola({
      ...ctx,
      datos: {
        fichas: reconfirmaciones.cola({ filtro }),
        filtro,
        ventana,
        dentroDeVentana: hoy() >= ventana.inicio && hoy() <= ventana.fin,
      },
    }),
  };
}

function verFichaReconfirmacion(ctx) {
  soloLectura(ctx);
  const ficha = reconfirmaciones.obtener(ctx.params.id);
  if (!ficha) throw new ErrorNoEncontrado('Esa ficha no existe.');
  return {
    html: paginaReconfirmacion.renderFicha({
      ...ctx,
      datos: {
        ficha,
        detalles: planes.detalles(ficha.plan_id),
        esDireccion: auth.esDireccion(ctx.usuario),
        faltantes: reconfirmaciones.faltantesParaConfirmar(ficha.plan_id),
        ventana: reconfirmaciones.ventana(),
        historial: todos(
          `SELECT h.*, u.nombre AS actor_nombre FROM historial h
           LEFT JOIN usuario u ON u.id = h.actor_id
           WHERE h.reconfirmacion_id = ? ORDER BY h.ocurrido_en DESC`,
          ficha.id,
        ),
      },
    }),
  };
}

function accionFicha(operacion) {
  return (ctx) => {
    const ficha = operacion(ctx.usuario, ctx.params.id, ctx.cuerpo);
    return {
      redirect: `/reconfirmacion/${ficha.id}`,
      aviso: { tono: 'exito', texto: mensajeDeFicha(ficha) },
    };
  };
}

function reprogramarReconfirmacion(ctx) {
  const ficha = reconfirmaciones.reprogramar(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return {
    redirect: `/reconfirmacion/${ficha.id}`,
    aviso: {
      tono: 'exito',
      texto: `Corrimos la reconfirmación al ${fechaCorta(ficha.fecha_prevista)}.`,
      ayuda: 'El cambio queda en el historial de la ficha.',
    },
  };
}

function mensajeDeFicha(ficha) {
  if (ficha.estado === 'Confirmado') return 'Registramos la confirmación con su sello de aprobación.';
  if (ficha.estado === 'No continua') return 'Registramos que el club no continúa, con su sello de aprobación.';
  if (ficha.estado === 'Condicional') return 'Registramos la respuesta condicional. El caso sigue abierto.';
  if (ficha.estado === 'Sin respuesta') return 'Registramos el intento sin respuesta. El caso sigue abierto.';
  if (ficha.estado === 'Contactado') return 'Registramos el contacto.';
  return 'Guardamos la ficha.';
}

function confirmarResultado(resultado) {
  return (ctx) => {
    const ficha = reconfirmaciones.validarResultado(ctx.usuario, ctx.params.id, resultado, ctx.cuerpo);
    return {
      redirect: `/reconfirmacion/${ficha.id}`,
      aviso: { tono: 'exito', texto: mensajeDeFicha(ficha) },
    };
  };
}

// --- Historial e indicadores -------------------------------------------------

function verHistorial(ctx) {
  soloLectura(ctx);
  const tipo = ctx.query.get('tipo') || '';
  return {
    html: varias.historial({
      ...ctx,
      datos: {
        eventos: consultas.historialGeneral({ tipo, limite: 200 }),
        tipos: consultas.tiposDeEvento(),
        tipo,
      },
    }),
  };
}

function verIndicador(ctx) {
  soloLectura(ctx);
  const detalle = consultas.registrosDeIndicador(ctx.params.clave, CICLO);
  if (!detalle) throw new ErrorNoEncontrado('Ese indicador no existe.');
  return { html: varias.indicador({ ...ctx, datos: { detalle } }) };
}

// --- Administración ----------------------------------------------------------

function datosAdmin() {
  const lista = usuarios.listar();
  const pendientesPorUsuario = {};
  const ultimoAcceso = {};
  for (const u of lista) {
    pendientesPorUsuario[u.id] = accesos.pendientesDe(u.id).length;
    const entro = uno(
      'SELECT usado_en FROM acceso WHERE usuario_id = ? AND usado_en IS NOT NULL ORDER BY usado_en DESC LIMIT 1',
      u.id,
    );
    ultimoAcceso[u.id] = entro ? entro.usado_en : null;
  }
  return {
    usuarios: lista,
    parametros: usuarios.parametros(),
    conflictos: conflictos.listar(),
    pendientesPorUsuario,
    ultimoAcceso,
    enlaceGenerado: null,
  };
}

function verAdmin(ctx) {
  soloLectura(ctx);
  return { html: paginaAdmin.render({ ...ctx, datos: datosAdmin() }) };
}

/**
 * Dirección genera un enlace para alguien. Se muestra una sola vez, acá mismo: no se
 * redirige, porque una dirección con el enlace adentro quedaría en el historial del
 * navegador. En la base solo queda su hash, así que no se puede volver a leer.
 */
function generarAcceso(ctx) {
  const { usuario, token, expiraEn } = accesos.generarParaOtro(ctx.usuario, ctx.params.id);
  const enlace = accesos.enlaceDe(token, baseDe(ctx));
  entrega.entregar({ usuario, enlace, expiraEn, pedidoPor: ctx.usuario.nombre });
  return {
    html: paginaAdmin.render({
      ...ctx,
      datos: {
        ...datosAdmin(),
        enlaceGenerado: { usuarioId: usuario.id, enlace, minutos: expiraEn },
      },
    }),
  };
}

function anularAcceso(ctx) {
  const cuantos = accesos.anular(ctx.usuario, ctx.params.id);
  return {
    redirect: '/admin#usuarios',
    aviso: { tono: 'exito', texto: `Anulamos ${cuantos} enlace(s) sin usar.` },
  };
}

function crearUsuario(ctx) {
  const creado = usuarios.crear(ctx.usuario, ctx.cuerpo);
  return { redirect: '/admin#usuarios', aviso: { tono: 'exito', texto: `Agregamos a ${creado.nombre}.` } };
}

function cambiarAcceso(ctx) {
  const cambiado = usuarios.cambiarAcceso(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return {
    redirect: '/admin#usuarios',
    aviso: { tono: 'exito', texto: `Actualizamos el acceso de ${cambiado.nombre}.` },
  };
}

function guardarParametros(ctx) {
  usuarios.guardarParametros(ctx.usuario, ctx.cuerpo);
  return { redirect: '/admin#parametros', aviso: { tono: 'exito', texto: 'Guardamos los parámetros del ciclo.' } };
}

function resolverConflicto(ctx) {
  conflictos.resolver(ctx.usuario, ctx.params.id, ctx.cuerpo);
  return { redirect: '/admin#conflictos', aviso: { tono: 'exito', texto: 'Marcamos el conflicto como resuelto.' } };
}

// --- Exportación -------------------------------------------------------------

function verExportar(ctx) {
  soloLectura(ctx);
  return {
    html: varias.exportar({
      ...ctx,
      datos: {
        tablas: exportar.TABLAS.map((nombre) => ({
          nombre,
          filas: uno(`SELECT count(*) AS n FROM ${nombre}`).n,
        })),
        rutaBase: RUTA_DB,
      },
    }),
  };
}

function descargarJson(ctx) {
  soloLectura(ctx);
  return {
    archivo: {
      nombre: `futsala-respaldo-${hoy()}.json`,
      tipo: 'application/json; charset=utf-8',
      contenido: JSON.stringify(exportar.respaldoCompleto(), null, 2),
    },
  };
}

function descargarCsv(ctx) {
  soloLectura(ctx);
  const filas = exportar.datosDeTabla(ctx.params.tabla);
  if (filas === null) throw new ErrorNoEncontrado('Esa tabla no existe.');
  return {
    archivo: {
      nombre: `${ctx.params.tabla}-${hoy()}.csv`,
      tipo: 'text/csv; charset=utf-8',
      contenido: filas.length === 0 ? '' : exportar.aCsv(filas),
    },
  };
}

function verAcerca(ctx) {
  return {
    html: paginaAcerca.render({
      ...ctx,
      datos: {
        rutaBase: RUTA_DB,
        resumenPruebas:
          'Las pruebas crean su propia base temporal y no tocan los datos de esta instalación. ' +
          'Ninguna prueba envía mensajes ni usa servicios externos.',
      },
    }),
  };
}
