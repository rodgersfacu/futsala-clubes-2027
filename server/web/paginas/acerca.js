import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';

export function render({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    <div class="cinta-demo">
      Esta instalación trabaja con los <strong>clubes reales de la planilla de venta</strong>. No hay
      publicación, ni invitaciones, ni envíos de ningún tipo: nada se comparte con los clubes, y
      los enlaces de acceso del equipo los reparte Dirección a mano.
    </div>

    ${ui.tarjeta({
      titulo: 'Arquitectura',
      cuerpo: html`
        ${ui.listaDatos(html`
          ${ui.dato('Servidor', 'Node.js sin dependencias externas (módulos node:http y node:sqlite)')}
          ${ui.dato('Base de datos', html`SQLite en un archivo propio: <span class="mono">${datos.rutaBase}</span>`)}
          ${ui.dato('Interfaz', 'HTML generado en el servidor, responsive, funciona sin JavaScript')}
          ${ui.dato('Dependencia de Google', 'Ninguna. No usa Sheets, AppSheet ni servicios de terceros')}
        `)}
        <p class="menor">
          Toda la lógica de negocio corre en el servidor. Las restricciones de integridad
          (unicidad, enteros no negativos, relaciones fijas, bloqueo de lo aprobado, historial de
          solo-agregado) están además en la base, con restricciones y disparadores propios.
        </p>`,
    })}

    ${ui.tarjeta({
      titulo: 'Funcional, con lógica real en servidor',
      tono: 'acento',
      cuerpo: html`
        <ul>
          <li><strong>Circuito completo:</strong> club → plan 2027 → disciplinas y tiras → reunión agendada → reunión realizada → acta aprobada → compromisos → reconfirmación → cierre del plan.</li>
          <li><strong>Autorización por rol</strong> aplicada en el servidor en cada operación, no en los botones: Dirección, Ayudante (solo sus actas asignadas y sus propias tareas abiertas) y Consulta (lectura).</li>
          <li><strong>Unicidad garantizada por la base:</strong> un plan por club y ciclo, una disciplina por plan, una ficha final por plan, un correo por usuario.</li>
          <li><strong>Relaciones fijas:</strong> la base rechaza mover un plan a otro club, o una reunión, disciplina o ficha a otro plan.</li>
          <li><strong>Cantidades:</strong> enteros de 0 o más; vacío se conserva como desconocido y nunca se convierte en cero; cada cantidad acordada queda atada al acta que la aprobó.</li>
          <li><strong>Bloqueo de lo aprobado:</strong> acta aprobada, lo acordado que respalda, cantidades finales, y planes cerrados quedan inmodificables incluso por petición directa.</li>
          <li><strong>Reapertura:</strong> solo Dirección, con motivo obligatorio, copia íntegra de lo aprobado, actor y sello del reloj del servidor, todo dentro de una transacción.</li>
          <li><strong>Historial de solo-agregado:</strong> la aplicación no ofrece editar ni borrar eventos y la base lo impide.</li>
          <li><strong>Concurrencia:</strong> cada registro lleva número de versión; la segunda escritura sobre la misma versión informa conflicto y muestra las diferencias en lugar de sobrescribir.</li>
          <li><strong>Resultado final:</strong> confirmar exige contacto, respuesta, evidencia, acta aprobada y todas las cantidades finales. Condicional y Sin respuesta no son confirmación ni baja.</li>
          <li><strong>Ventana 01/01/2027–28/02/2027</strong> con motivo de excepción para registrar un contacto real fuera de ella.</li>
          <li><strong>Indicadores por clubes únicos</strong>, con conflictos de duplicados visibles y excluidos del total confirmado, retención vacía si no hay clubes, y cobertura de cantidades.</li>
          <li><strong>Exportación propia</strong> en JSON y CSV, más copia directa del archivo de base.</li>
        </ul>`,
    })}

    ${ui.tarjeta({
      titulo: 'Simulado o identificado como demostración',
      cuerpo: html`
        <ul>
          <li>
            <strong>Entrega del enlace de acceso.</strong> La aplicación no manda correos: el enlace
            queda en la consola del servidor y en un registro que solo ve quien tiene la máquina, y
            Dirección se lo pasa a cada uno. Activar envíos por correo es una decisión aparte.
          </li>
          <li>
            <strong>Cifrado del transporte.</strong> La aplicación va por HTTP sin cifrar. En la
            máquina propia no importa; en una red compartida, el enlace de acceso y la cookie de
            sesión viajan a la vista. Por eso el servidor escucha solo en esta máquina salvo que se
            pida lo contrario con <span class="mono">FUTSALA_RED=1</span>.
          </li>
          <li>
            <strong>Datos.</strong> Los clubes, planes y reuniones de ejemplo son inventados y están
            marcados como tales. El juego de prueba se recrea con <span class="mono">npm run reiniciar</span>.
          </li>
          <li>
            <strong>Evidencias y adjuntos.</strong> Se guardan como enlaces escritos a mano. Todavía no hay
            almacenamiento propio de archivos ni permisos sobre ellos.
          </li>
        </ul>`,
    })}

    ${ui.tarjeta({
      titulo: 'Pendiente',
      cuerpo: html`
        <ul>
          <li><strong>Autenticación real</strong> y gestión de sesiones, con alta de las personas de FUTSALA.</li>
          <li><strong>Despliegue</strong> en un servidor accesible, con HTTPS, respaldo automático y restauración probada.</li>
          <li><strong>Almacenamiento de adjuntos</strong> propio, con permisos iguales a los del registro.</li>
          <li><strong>Avisos internos</strong> (acta para revisar, agenda del día siguiente, vencimientos, pendientes de reconfirmación, cierre de ventana el 01/03/2027): diseñados, no construidos. Sin canal de envío y con los interruptores apagados.</li>
          <li><strong>Catálogo definitivo de disciplinas</strong> y la definición operativa de "tira" que use FUTSALA.</li>
          <li><strong>Identidad visual</strong> definitiva: la actual es una propuesta sobria, sin logo oficial.</li>
          <li><strong>Integraciones opcionales</strong> (calendario, archivos): la aplicación funciona sin ellas y no se empezaron.</li>
        </ul>`,
    })}

    ${ui.tarjeta({
      titulo: 'Decisiones tomadas al pasar de AppSheet a esta aplicación',
      cuerpo: html`
        <ul>
          <li>Los usuarios se identifican con un id estable y el correo queda como atributo único, en lugar de usar el correo como clave foránea.</li>
          <li>La reapertura y su auditoría ocurren en una sola transacción. Se descartó el mecanismo provisional de AppSheet que buscaba una entrada del último minuto.</li>
          <li>Las reaperturas van en orden: primero el plan, después la reconfirmación y por último el acta. La aplicación lo exige y lo explica.</li>
          <li>Los duplicados que no puede haber se evitan con restricciones de base; los que vinieran de una importación quedan registrados como conflicto visible y bloquean confirmar y cerrar ese plan.</li>
          <li>Un ayudante puede crear y resolver compromisos propios a partir del acta que le asignaron, con la restricción aplicada en servidor (usuario activo, rol y responsable). En AppSheet esa facultad estaba apagada por falta de esa restricción.</li>
          <li>Nada se borra: los registros con historial se archivan o se cancelan con motivo.</li>
        </ul>`,
    })}

    ${ui.tarjeta({
      titulo: 'Cómo se verifica',
      cuerpo: html`
        <p>
          <span class="mono">npm run pruebas</span> ejecuta los escenarios de aceptación contra una base
          temporal aislada: circuito completo, permisos por rol y por petición directa, inmutabilidad,
          bloqueos, reapertura con auditoría en transacción, unicidad, concurrencia, cantidades, fechas,
          ventana de reconfirmación e indicadores.
        </p>
        <p class="menor">${datos.resumenPruebas}</p>`,
    })}`;

  return pagina({
    titulo: 'Estado de la aplicación',
    subtitulo: 'Qué funciona de verdad, qué es demostración y qué falta.',
    ruta: '/acerca',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}
