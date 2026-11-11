import { html, aTexto } from '../html.js';
import { fechaCorta, fechaHoraCorta, hoy } from '../../lib/fechas.js';

/**
 * Hoja de una carilla para llevar impresa a la reunión. Es una página aparte, sin
 * navegación, pensada para "Imprimir" o "Guardar como PDF" del navegador.
 */
export function render({ datos }) {
  const { club, plan, detalles, reunion, ventana } = datos;

  const cuerpo = html`<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${club.nombre} · FUTSALA</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root { --tinta: #0d1b33; --borde: #c9d3e4; --tenue: #5a6b85; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1.5rem;
      font: 13pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: var(--tinta); background: #fff; max-width: 820px; margin-inline: auto;
    }
    header { display: flex; align-items: center; gap: .8rem; border-bottom: 2px solid var(--tinta); padding-bottom: .6rem; }
    header img { height: 46px; width: auto; }
    .marca { background: var(--tinta); padding: .35rem .5rem; border-radius: 6px; display: flex; }
    h1 { font-size: 17pt; margin: 0; }
    .sub { color: var(--tenue); font-size: 10pt; margin-top: .15rem; }
    .ciclo { margin-left: auto; text-align: right; font-size: 9.5pt; color: var(--tenue); }
    h2 { font-size: 11pt; margin: 1.1rem 0 .4rem; text-transform: uppercase; letter-spacing: .06em; color: var(--tenue); }
    table { width: 100%; border-collapse: collapse; font-size: 11pt; }
    th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; color: var(--tenue);
         border-bottom: 1.5px solid var(--borde); padding: .3rem .4rem; }
    td { border-bottom: 1px solid var(--borde); padding: .4rem; vertical-align: top; }
    td.n { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cat { font-weight: 650; }
    /* Un renglón de la planilla de venta es un renglón en la hoja impresa. */
    td.planilla { white-space: pre-line; }
    .datos { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem 1rem; font-size: 10.5pt; }
    .datos div span { display: block; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; color: var(--tenue); }
    .texto { white-space: pre-wrap; font-size: 11pt; }
    .visita { color: #0369a1; }
    .notas { border: 1px dashed var(--borde); border-radius: 6px; height: 7.5rem; margin-top: .3rem; }
    .pie { margin-top: 1.4rem; border-top: 1px solid var(--borde); padding-top: .5rem;
           font-size: 8.5pt; color: var(--tenue); display: flex; justify-content: space-between; }
    .acciones { margin: 1.2rem 0 0; display: flex; gap: .5rem; }
    button, a.boton {
      font: inherit; font-size: 10.5pt; font-weight: 600; cursor: pointer; text-decoration: none;
      padding: .45rem .9rem; border-radius: 7px; border: 1px solid var(--tinta);
      background: var(--tinta); color: #fff;
    }
    a.boton { background: #fff; color: var(--tinta); }
    @media print {
      body { padding: 0; max-width: none; font-size: 11pt; }
      .acciones { display: none; }
      .notas { height: 6rem; }
      h2 { margin-top: .8rem; }
    }
  </style>
</head>
<body>
  <header>
    <span class="marca"><img src="/marca.webp" alt="FUTSALA"></span>
    <div>
      <h1>${club.nombre}</h1>
      <p class="sub">${[club.localidad, club.contacto_nombre ? `Contacto: ${club.contacto_nombre}` : null]
        .filter(Boolean)
        .join(' · ')}</p>
    </div>
    <div class="ciclo">
      Reuniones 2027<br>
      Ciclo ${plan ? `${plan.anio_cierre}/${plan.anio_objetivo}` : '2026/2027'}<br>
      Prioridad ${club.prioridad}
    </div>
  </header>

  ${reunion
    ? html`
        <h2>Reunión</h2>
        <div class="datos">
          <div><span>Cuándo</span>${reunion.inicio ? fechaHoraCorta(reunion.inicio) : 'a definir'}</div>
          <div><span>Dónde</span>${
            reunion.modalidad === 'En el club'
              ? html`<strong class="visita">↗ En el club</strong>${reunion.lugar ? ` · ${reunion.lugar}` : ''}`
              : html`${reunion.modalidad}${reunion.lugar ? ` · ${reunion.lugar}` : ''}`
          }</div>
          <div><span>La tiene</span>${reunion.director1_nombre || '—'}${
            reunion.director2_nombre ? ` y ${reunion.director2_nombre}` : ''
          }</div>
          <div><span>Toma nota</span>${reunion.acta_responsable_nombre || '—'}</div>
          <div><span>Estado</span>${reunion.estado}</div>
          <div><span>Contacto del club</span>${club.contacto_telefono || club.contacto_email || '—'}</div>
        </div>`
    : ''}

  <h2>Lo pretendido para 2027</h2>
  <table>
    <thead>
      <tr><th>Disciplina</th><th>2026</th><th>2027</th><th>Acordado</th></tr>
    </thead>
    <tbody>
      ${detalles.length === 0
        ? html`<tr><td colspan="4">Sin disciplinas cargadas.</td></tr>`
        : detalles.map(
            (d) => html`
              <tr>
                <td class="cat">${d.disciplina}</td>
                <td class="planilla">${
                  d.tiras_base !== null && d.tiras_base !== undefined ? html`<strong>${d.tiras_base}</strong> ` : ''
                }${d.divisiones_2026 ?? ''}</td>
                <td class="planilla">${d.tiras_propuestas !== null && d.tiras_propuestas !== undefined
                  ? html`<strong>${d.tiras_propuestas}</strong> `
                  : ''}${d.intencion_2027 ?? ''}</td>
                <td class="planilla">${d.acordado_texto ?? ''}</td>
              </tr>`,
          )}
    </tbody>
  </table>

  ${reunion && reunion.nota ? html`<h2>Observaciones</h2><div class="texto">${reunion.nota}</div>` : ''}

  <h2>Notas de la reunión</h2>
  <div class="notas"></div>

  <h2>Acordado y próximos pasos</h2>
  <div class="notas"></div>

  <div class="pie">
    <span>Reconfirmación prevista: ${fechaCorta(ventana.inicio)} a ${fechaCorta(ventana.fin)}</span>
    <span>Impreso el ${fechaCorta(hoy())} · uso interno de FUTSALA</span>
  </div>

  <div class="acciones">
    <button type="button" onclick="window.print()">Imprimir o guardar PDF</button>
    <a class="boton" href="/clubes/${club.id}">Volver a la ficha</a>
  </div>
</body>
</html>`;
  return aTexto(cuerpo);
}
