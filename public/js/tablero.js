// Tablero Kanban: columnas por estado, drag & drop, filtros y detalle de tarea.
// Las reglas de transición las valida el servidor; aquí solo se muestra el resultado.
const { escaparHtml: esc } = App;
const proyectoId = Number(App.parametro('proyecto'));
const tableroId = Number(App.parametro('tablero'));
const kanban = document.getElementById('kanban');
const modalNueva = new bootstrap.Modal(document.getElementById('modalNuevaTarea'));
const modalTareaEl = document.getElementById('modalTarea');
const modalTarea = new bootstrap.Modal(modalTareaEl);
const modalColumna = new bootstrap.Modal(document.getElementById('modalColumna'));

let tablero = null;        // { tablero, columnas, tareas, tableros, usuarios }
let sortables = [];
let detalle = null;        // { tarea, subtareas, comentarios, bitacora }
const subtareasAbiertas = new Set();

// ── Campos de tarea (misma plantilla para "nueva" y "detalle") ──────────
document.querySelectorAll('.campos-tarea').forEach(zona => {
    zona.innerHTML = document.getElementById('plantillaCampos').innerHTML.replaceAll('{p}', zona.dataset.prefijo);
});
const campo = (prefijo, nombre) => document.getElementById(prefijo + nombre);

function llenarResponsables(prefijo, seleccionado) {
    campo(prefijo, 'Responsable').innerHTML = '<option value="">Sin asignar</option>' +
        tablero.usuarios.map(u => `<option value="${u.id}">${esc(u.nombre)} (${esc(u.rol)})</option>`).join('');
    campo(prefijo, 'Responsable').value = seleccionado || '';
}

function leerCampos(prefijo) {
    return {
        titulo: campo(prefijo, 'Titulo').value.trim(),
        descripcion: campo(prefijo, 'Descripcion').value.trim(),
        tipo: campo(prefijo, 'Tipo').value,
        prioridad: campo(prefijo, 'Prioridad').value,
        responsable_id: campo(prefijo, 'Responsable').value || null,
        etiquetas: campo(prefijo, 'Etiquetas').value,
        fecha_inicio: campo(prefijo, 'Inicio').value || null,
        fecha_limite: campo(prefijo, 'Limite').value || null,
    };
}

// Validación en el navegador (el servidor vuelve a validar todo)
function validarCampos(prefijo, datos) {
    const titulo = campo(prefijo, 'Titulo');
    const limite = campo(prefijo, 'Limite');
    titulo.classList.toggle('is-invalid', !datos.titulo);
    const fechasMal = datos.fecha_inicio && datos.fecha_limite && datos.fecha_limite < datos.fecha_inicio;
    limite.classList.toggle('is-invalid', !!fechasMal);
    return datos.titulo && !fechasMal;
}

// ── Pintar tablero ───────────────────────────────────────────────────────
function etiquetasDe(t) {
    return (t.etiquetas || '').split(',').map(e => e.trim()).filter(Boolean);
}

function tarjetaHtml(t) {
    const avance = t.total_subtareas ? Math.round((t.subtareas_completadas / t.total_subtareas) * 100) : 0;
    let fecha = '';
    if (t.estado_tipo === 'completado' && t.fecha_cierre) fecha = `<span>Cerrada ${App.fecha(t.fecha_cierre.slice(0, 10))}</span>`;
    else if (t.fecha_limite) fecha = `<span class="fecha ${t.vencida ? 'vencida' : ''}">${t.vencida ? 'Vencida' : 'Vence'} ${App.fecha(t.fecha_limite)}</span>`;
    return `
        <div class="tarjeta-tarea ${t.vencida ? 'vencida' : ''} ${t.tipo === 'Bug' ? 'es-bug' : ''}" data-id="${t.id}" tabindex="0" role="button" aria-label="Abrir ${esc(t.titulo)}">
            <div class="fila">
                ${t.tipo === 'Bug' ? '<span class="insignia critico">Bug</span>' : ''}
                ${App.insigniaPrioridad(t.prioridad)}
                ${etiquetasDe(t).map(e => `<span class="etiqueta-chip">${esc(e)}</span>`).join('')}
            </div>
            <div class="titulo">${esc(t.titulo)}</div>
            ${t.total_subtareas ? `
                <div class="d-flex align-items-center gap-2">
                    <div class="progreso flex-grow-1"><div style="width:${avance}%"></div></div>
                    <span class="small text-secondary-ui">${t.subtareas_completadas}/${t.total_subtareas}</span>
                </div>` : ''}
            <div class="pie">
                ${t.responsable_nombre
                    ? `<span class="avatar sm" title="${esc(t.responsable_nombre)}">${esc(App.iniciales(t.responsable_nombre))}</span>`
                    : '<span class="text-muted">Sin asignar</span>'}
                ${fecha}
                ${t.total_comentarios ? `<span class="ms-auto">${t.total_comentarios} coment.</span>` : ''}
            </div>
        </div>`;
}

function tareasFiltradas() {
    const texto = document.getElementById('filtroTexto').value.trim().toLowerCase();
    const tipo = document.getElementById('filtroTipo').value;
    const prioridad = document.getElementById('filtroPrioridad').value;
    const responsable = document.getElementById('filtroResponsable').value;
    const soloVencidas = document.getElementById('filtroVencidas').checked;
    return tablero.tareas.filter(t =>
        (!texto || t.titulo.toLowerCase().includes(texto) || (t.etiquetas || '').toLowerCase().includes(texto)) &&
        (!tipo || t.tipo === tipo) &&
        (!prioridad || t.prioridad === prioridad) &&
        (!responsable || (responsable === 'ninguno' ? !t.responsable_id : String(t.responsable_id) === responsable)) &&
        (!soloVencidas || t.vencida));
}

function pintarKanban() {
    sortables.forEach(s => s.destroy());
    sortables = [];
    const visibles = tareasFiltradas();
    const esAdmin = App.estado.esAdmin;

    kanban.innerHTML = tablero.columnas.map(c => {
        const tareas = visibles.filter(t => t.estado_id === c.id);
        const menu = esAdmin ? `
            <div class="dropdown acciones">
                <button class="btn-plano" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Opciones de la columna ${esc(c.nombre)}">Opciones</button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><button class="dropdown-item" type="button" data-columna="${c.id}" data-accion="renombrar">Renombrar</button></li>
                    <li><button class="dropdown-item peligro" type="button" data-columna="${c.id}" data-accion="eliminar">Eliminar</button></li>
                </ul>
            </div>` : '';
        return `
            <section class="columna" aria-label="${esc(c.nombre)}">
                <div class="columna-encabezado">
                    <span class="indicador-estado estado-${c.tipo}" title="${esc(App.ESTADOS[c.tipo])}"></span>
                    <span class="nombre">${esc(c.nombre)}</span>
                    <span class="total">${tareas.length}</span>
                    ${menu}
                </div>
                <div class="columna-tareas ${tareas.length ? '' : 'vacia'}" data-columna="${c.id}">
                    ${tareas.map(tarjetaHtml).join('')}
                </div>
            </section>`;
    }).join('');

    kanban.querySelectorAll('.columna-tareas').forEach(zona => {
        sortables.push(new Sortable(zona, {
            group: 'kanban',
            animation: 150,
            sort: false, // El orden dentro de una columna no se guarda
            onMove: () => kanban.querySelectorAll('.columna-tareas').forEach(z => z.classList.remove('vacia')),
            onEnd: (evt) => {
                if (evt.from === evt.to) return pintarKanban();
                moverTarea(Number(evt.item.dataset.id), Number(evt.to.dataset.columna));
            },
        }));
    });

    const r = { total: tablero.tareas.length, vencidas: tablero.tareas.filter(t => t.vencida).length };
    document.getElementById('resumenTablero').textContent =
        `${r.total} tarea(s)${r.vencidas ? ` · ${r.vencidas} vencida(s)` : ''}${visibles.length !== r.total ? ` · mostrando ${visibles.length}` : ''}`;
}

async function cargarTablero() {
    tablero = await App.api(`/api/tableros/${tableroId}`);
    const t = tablero.tablero;
    document.title = `${t.nombre} - QA Proyectos`;
    document.getElementById('nombreTablero').textContent = t.nombre;
    const miga = document.getElementById('migaProyecto');
    miga.textContent = t.proyecto_nombre;
    miga.href = `/proyectos.html#proyecto-${t.proyecto_id}`;

    const selector = document.getElementById('selectorTablero');
    selector.classList.toggle('d-none', tablero.tableros.length < 2);
    selector.innerHTML = tablero.tableros.map(x => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');

    const filtroResp = document.getElementById('filtroResponsable');
    const previo = filtroResp.value;
    filtroResp.innerHTML = '<option value="">Todos los responsables</option><option value="ninguno">Sin asignar</option>' +
        tablero.usuarios.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
    filtroResp.value = [...filtroResp.options].some(o => o.value === previo) ? previo : '';
    pintarKanban();
}

// ── Mover tarea (drag & drop o selector del detalle) ─────────────────────
async function moverTarea(tareaId, columnaId) {
    const tarea = tablero.tareas.find(t => t.id === tareaId);
    const destino = tablero.columnas.find(c => c.id === columnaId);
    let motivo = '';
    try {
        const regresaDeRevision = tarea.estado_tipo === 'en_revision' && destino.tipo === 'en_progreso';
        const reabre = tarea.estado_tipo === 'completado' && destino.tipo !== 'completado';
        if (regresaDeRevision || (reabre && App.estado.esAdmin)) {
            motivo = await App.pedirTexto({
                titulo: regresaDeRevision ? 'Regresar a En progreso' : 'Reabrir tarea',
                mensaje: regresaDeRevision
                    ? 'Describe el defecto encontrado durante la revisión. Quedará registrado como comentario y en el historial.'
                    : 'Indica por qué se reabre esta tarea cerrada.',
                campo: { etiqueta: regresaDeRevision ? 'Defecto encontrado' : 'Motivo', multilinea: true },
                textoBoton: regresaDeRevision ? 'Regresar tarea' : 'Reabrir',
            });
            if (!motivo) { pintarKanban(); return false; }
        }
        const r = await App.api(`/api/tareas/${tareaId}/estado`, { method: 'PUT', body: { columna_id: columnaId, motivo } });
        App.aviso(r.mensaje);
        await cargarTablero();
        return true;
    } catch (e) {
        App.error(e);
        pintarKanban(); // Devuelve la tarjeta a su columna real
        return false;
    }
}

// ── Nueva tarea ──────────────────────────────────────────────────────────
document.getElementById('btnNuevaTarea').addEventListener('click', () => {
    const form = document.getElementById('formNuevaTarea');
    form.reset();
    form.querySelectorAll('.is-invalid').forEach(e => e.classList.remove('is-invalid'));
    document.getElementById('errorNuevaTarea').textContent = '';
    llenarResponsables('nueva', '');
    modalNueva.show();
});
document.getElementById('modalNuevaTarea').addEventListener('shown.bs.modal', () => campo('nueva', 'Titulo').focus());

document.getElementById('formNuevaTarea').addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = leerCampos('nueva');
    if (!validarCampos('nueva', datos)) return;
    try {
        await App.api(`/api/tableros/${tableroId}/tareas`, { method: 'POST', body: datos });
        modalNueva.hide();
        App.aviso('Tarea creada en Por hacer.');
        await cargarTablero();
    } catch (err) {
        document.getElementById('errorNuevaTarea').textContent = err.message;
    }
});

// ── Detalle de tarea ─────────────────────────────────────────────────────
async function abrirTarea(id) {
    try {
        await cargarDetalle(id);
        modalTarea.show();
    } catch (e) { App.error(e); }
}

async function cargarDetalle(id) {
    detalle = await App.api(`/api/tareas/${id}`);
    pintarDetalle();
}

function pintarDetalle() {
    const { tarea: t, subtareas, comentarios, bitacora } = detalle;
    const esAdmin = App.estado.esAdmin;
    const cerrada = t.estado_tipo === 'completado';

    document.getElementById('tituloDetalle').textContent = t.titulo;
    document.getElementById('insigniasDetalle').innerHTML =
        `${t.tipo === 'Bug' ? '<span class="insignia critico">Bug</span>' : '<span class="insignia contorno">Tarea</span>'}
         ${App.insigniaEstado(t.estado_tipo, t.estado_nombre)} ${App.insigniaPrioridad(t.prioridad)}
         ${t.vencida ? '<span class="insignia critico">Vencida</span>' : ''}`;

    const avisoCerrada = document.getElementById('avisoCerrada');
    avisoCerrada.textContent = cerrada
        ? `Tarea completada y cerrada el ${App.fechaHora(t.fecha_cierre)}. ${esAdmin ? 'Como Administrador puedes editarla o reabrirla.' : 'Está en modo de solo lectura.'}`
        : '';

    // Formulario de detalles
    campo('detalle', 'Titulo').value = t.titulo;
    campo('detalle', 'Descripcion').value = t.descripcion || '';
    campo('detalle', 'Tipo').value = t.tipo || 'Tarea';
    campo('detalle', 'Prioridad').value = t.prioridad || 'Media';
    llenarResponsables('detalle', t.responsable_id);
    if (t.responsable_id && !tablero.usuarios.some(u => u.id === t.responsable_id)) {
        campo('detalle', 'Responsable').insertAdjacentHTML('beforeend', `<option value="${t.responsable_id}">${esc(t.responsable_nombre)} (ya no es miembro)</option>`);
        campo('detalle', 'Responsable').value = t.responsable_id;
    }
    campo('detalle', 'Etiquetas').value = t.etiquetas || '';
    campo('detalle', 'Inicio').value = t.fecha_inicio || '';
    campo('detalle', 'Limite').value = t.fecha_limite || '';
    document.getElementById('errorDetalle').textContent = '';
    document.querySelectorAll('#formDetalle .is-invalid').forEach(e => e.classList.remove('is-invalid'));
    document.querySelectorAll('#formDetalle input, #formDetalle select, #formDetalle textarea, #btnGuardarDetalle')
        .forEach(el => (el.disabled = cerrada && !esAdmin));

    // Estado y movimiento
    document.getElementById('estadoActual').innerHTML = `${App.insigniaEstado(t.estado_tipo, t.estado_nombre)}`;
    document.getElementById('selectMover').innerHTML = '<option value="">Mover a…</option>' +
        tablero.columnas.filter(c => c.id !== t.estado_id)
            .map(c => `<option value="${c.id}">${esc(c.nombre)}${c.nombre !== App.ESTADOS[c.tipo] ? ` (${App.ESTADOS[c.tipo]})` : ''}</option>`).join('');

    const filasFecha = [
        ['Creada por', esc(t.creador_nombre || '—')],
        ['Fecha de creación', App.fechaHora(t.fecha_creacion)],
        ['Fecha de inicio', t.fecha_inicio ? App.fecha(t.fecha_inicio) : '—'],
        ['Fecha límite', t.fecha_limite ? `<span class="${t.vencida ? 'text-critical fw-semibold' : ''}">${App.fecha(t.fecha_limite)}${t.vencida ? ' (vencida)' : ''}</span>` : '—'],
        ['Fecha de cierre', t.fecha_cierre ? App.fechaHora(t.fecha_cierre) : '—'],
    ];
    document.getElementById('panelFechas').innerHTML = `<div class="row g-0">${filasFecha.map(([k, v]) =>
        `<div class="col-6"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</div>`;

    // Subtareas con checklist
    const completadas = subtareas.filter(s => s.completada).length;
    const avance = subtareas.length ? Math.round((completadas / subtareas.length) * 100) : 0;
    document.getElementById('barraAvance').style.width = `${avance}%`;
    document.getElementById('textoAvance').textContent = subtareas.length
        ? `${completadas} de ${subtareas.length} completadas (${avance}%)` : 'Sin subtareas';
    document.getElementById('listaSubtareas').innerHTML = subtareas.map(s => {
        const hechos = s.items.filter(i => i.completado).length;
        const abierta = subtareasAbiertas.has(s.id);
        return `
            <div class="subtarea ${s.completada ? 'completada' : ''}" data-subtarea="${s.id}">
                <div class="subtarea-cabecera">
                    <input class="form-check-input mt-0" type="checkbox" data-accion="completar-sub" ${s.completada ? 'checked' : ''} ${cerrada ? 'disabled' : ''} aria-label="Marcar subtarea ${esc(s.titulo)}">
                    <span class="titulo">${esc(s.titulo)}</span>
                    <span class="insignia ${s.completada ? 'exito' : ''}">${s.completada ? 'Completada' : 'Pendiente'}</span>
                    <button class="btn-plano" type="button" data-accion="ver-checklist" aria-expanded="${abierta}">Checklist ${s.items.length ? `${hechos}/${s.items.length}` : ''}</button>
                    ${cerrada ? '' : `<div class="dropdown">
                        <button class="btn-plano" type="button" data-bs-toggle="dropdown" aria-label="Opciones de la subtarea">Opciones</button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li><button class="dropdown-item" type="button" data-accion="renombrar-sub">Renombrar</button></li>
                            <li><button class="dropdown-item peligro" type="button" data-accion="eliminar-sub">Eliminar</button></li>
                        </ul></div>`}
                </div>
                <div class="subtarea-checklist ${abierta ? '' : 'd-none'}">
                    ${s.items.map(i => `
                        <div class="item-checklist ${i.completado ? 'hecho' : ''}" data-item="${i.id}">
                            <input class="form-check-input mt-0" type="checkbox" data-accion="completar-item" ${i.completado ? 'checked' : ''} ${cerrada ? 'disabled' : ''} aria-label="${esc(i.texto)}">
                            <span class="flex-grow-1">${esc(i.texto)}</span>
                            ${cerrada ? '' : '<button class="btn-plano" type="button" data-accion="eliminar-item">Quitar</button>'}
                        </div>`).join('') || '<div class="text-muted small mb-1">Sin elementos. La subtarea se puede completar directamente.</div>'}
                    ${cerrada ? '' : `<form class="d-flex gap-2 mt-2" data-accion="agregar-item">
                        <input type="text" class="form-control form-control-sm" placeholder="Nuevo elemento del checklist" maxlength="150" aria-label="Nuevo elemento del checklist">
                        <button class="btn btn-secundario btn-sm" type="submit">Agregar</button></form>`}
                </div>
            </div>`;
    }).join('') || '<p class="text-muted">Agrega subtareas para descomponer el trabajo. Se necesitan todas completadas para enviar la tarea a revisión.</p>';
    document.getElementById('formSubtarea').classList.toggle('d-none', cerrada);

    // Comentarios
    document.getElementById('pestanaComentarios').textContent = `Comentarios (${comentarios.length})`;
    document.getElementById('listaComentarios').innerHTML = comentarios.map(c => `
        <div class="comentario ${/^(Defecto|Reapertura)/.test(c.texto) ? 'defecto' : ''}">
            <div class="d-flex align-items-center gap-2 mb-1">
                <span class="avatar sm">${esc(App.iniciales(c.nombre))}</span>
                <strong>${esc(c.nombre || 'Usuario eliminado')}</strong>
                <span class="insignia contorno">${esc(c.rol || '')}</span>
                <span class="text-muted small ms-auto">${App.fechaHora(c.fecha)}</span>
            </div>
            <div style="white-space: pre-wrap">${esc(c.texto)}</div>
        </div>`).join('') || '<p class="text-muted">Sin comentarios todavía.</p>';

    // Historial (trazabilidad)
    document.getElementById('pestanaHistorial').textContent = `Historial (${bitacora.length})`;
    document.getElementById('listaHistorial').innerHTML = bitacora.map(b => `
        <li><div><strong>${esc(b.nombre || 'Sistema')}</strong> ${esc(b.accion)}</div>
            <div class="text-muted small">${App.fechaHora(b.fecha)}</div></li>`).join('')
        || '<li class="text-muted">Sin actividad registrada.</li>';

    document.getElementById('btnEliminarTarea').classList.toggle('d-none', !esAdmin);
}

// Ejecuta una acción del detalle y refresca el detalle y el tablero
async function accionDetalle(fn, mensaje) {
    try {
        await fn();
        if (mensaje) App.aviso(mensaje);
    } catch (e) { App.error(e); }
    await cargarDetalle(detalle.tarea.id).catch(App.error);
    cargarTablero().catch(App.error);
}

document.getElementById('formDetalle').addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = leerCampos('detalle');
    if (!validarCampos('detalle', datos)) return;
    try {
        const r = await App.api(`/api/tareas/${detalle.tarea.id}`, { method: 'PUT', body: datos });
        App.aviso(r.mensaje);
        await cargarDetalle(detalle.tarea.id);
        cargarTablero();
    } catch (err) {
        document.getElementById('errorDetalle').textContent = err.message;
    }
});

document.getElementById('btnMover').addEventListener('click', async () => {
    const columnaId = Number(document.getElementById('selectMover').value);
    if (!columnaId) return App.aviso('Elige la columna destino.', 'error');
    if (await moverTarea(detalle.tarea.id, columnaId)) await cargarDetalle(detalle.tarea.id);
});

document.getElementById('formSubtarea').addEventListener('submit', (e) => {
    e.preventDefault();
    const entrada = document.getElementById('tituloSubtarea');
    const titulo = entrada.value.trim();
    if (!titulo) return entrada.focus();
    accionDetalle(async () => {
        await App.api(`/api/tareas/${detalle.tarea.id}/subtareas`, { method: 'POST', body: { titulo } });
        entrada.value = '';
    });
});

const listaSubtareas = document.getElementById('listaSubtareas');
listaSubtareas.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-accion]');
    if (!el || el.tagName === 'FORM') return;
    const subId = Number(el.closest('[data-subtarea]').dataset.subtarea);
    const sub = detalle.subtareas.find(s => s.id === subId);
    switch (el.dataset.accion) {
        case 'ver-checklist':
            subtareasAbiertas.has(subId) ? subtareasAbiertas.delete(subId) : subtareasAbiertas.add(subId);
            pintarDetalle();
            break;
        case 'completar-sub':
            accionDetalle(() => App.api(`/api/subtareas/${subId}`, { method: 'PUT', body: { completada: el.checked } }));
            break;
        case 'renombrar-sub': {
            const titulo = await App.pedirTexto({ titulo: 'Renombrar subtarea', textoBoton: 'Guardar', campo: { etiqueta: 'Título', valor: sub.titulo, maximo: 150 } });
            if (titulo) accionDetalle(() => App.api(`/api/subtareas/${subId}`, { method: 'PUT', body: { titulo } }));
            break;
        }
        case 'eliminar-sub': {
            const ok = await App.confirmar({ titulo: 'Eliminar subtarea', mensaje: `Se eliminará "${sub.titulo}" y su checklist.`, textoBoton: 'Eliminar', peligro: true });
            if (ok) accionDetalle(() => App.api(`/api/subtareas/${subId}`, { method: 'DELETE' }), 'Subtarea eliminada.');
            break;
        }
        case 'completar-item': {
            const itemId = el.closest('[data-item]').dataset.item;
            accionDetalle(() => App.api(`/api/items/${itemId}`, { method: 'PUT', body: { completado: el.checked } }));
            break;
        }
        case 'eliminar-item': {
            const itemId = el.closest('[data-item]').dataset.item;
            accionDetalle(() => App.api(`/api/items/${itemId}`, { method: 'DELETE' }));
            break;
        }
    }
});

listaSubtareas.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-accion="agregar-item"]');
    if (!form) return;
    e.preventDefault();
    const texto = form.querySelector('input').value.trim();
    if (!texto) return;
    const subId = form.closest('[data-subtarea]').dataset.subtarea;
    accionDetalle(() => App.api(`/api/subtareas/${subId}/items`, { method: 'POST', body: { texto } }));
});

document.getElementById('formComentario').addEventListener('submit', (e) => {
    e.preventDefault();
    const entrada = document.getElementById('textoComentario');
    const texto = entrada.value.trim();
    if (!texto) return entrada.focus();
    accionDetalle(async () => {
        await App.api(`/api/tareas/${detalle.tarea.id}/comentarios`, { method: 'POST', body: { texto } });
        entrada.value = '';
    });
});

document.getElementById('btnEliminarTarea').addEventListener('click', async () => {
    const ok = await App.confirmar({
        titulo: 'Eliminar tarea', peligro: true, textoBoton: 'Eliminar tarea',
        mensaje: `Se eliminará "${detalle.tarea.titulo}" con sus subtareas, comentarios e historial. Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    try {
        await App.api(`/api/tareas/${detalle.tarea.id}`, { method: 'DELETE' });
        modalTarea.hide();
        App.aviso('Tarea eliminada.');
        await cargarTablero();
    } catch (e) { App.error(e); }
});

modalTareaEl.addEventListener('hidden.bs.modal', () => {
    subtareasAbiertas.clear();
    // Quita ?tarea= de la URL al cerrar el detalle
    if (App.parametro('tarea')) history.replaceState(null, '', `/tablero.html?proyecto=${proyectoId}&tablero=${tableroId}`);
});

// Abrir el detalle con clic o Enter sobre una tarjeta
kanban.addEventListener('click', (e) => {
    const tarjeta = e.target.closest('.tarjeta-tarea');
    if (tarjeta) abrirTarea(Number(tarjeta.dataset.id));
});
kanban.addEventListener('keydown', (e) => {
    const tarjeta = e.target.closest('.tarjeta-tarea');
    if (tarjeta && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirTarea(Number(tarjeta.dataset.id)); }
});

// ── Columnas (Administrador) ─────────────────────────────────────────────
kanban.addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-columna][data-accion]');
    if (!boton) return;
    const columna = tablero.columnas.find(c => c.id === Number(boton.dataset.columna));
    try {
        if (boton.dataset.accion === 'renombrar') {
            const nombre = await App.pedirTexto({ titulo: 'Renombrar columna', textoBoton: 'Guardar', campo: { etiqueta: 'Nombre', valor: columna.nombre, maximo: 50 } });
            if (!nombre) return;
            await App.api(`/api/columnas/${columna.id}`, { method: 'PUT', body: { nombre } });
            App.aviso('Columna renombrada.');
        } else {
            const ok = await App.confirmar({ titulo: 'Eliminar columna', mensaje: `Se eliminará la columna "${columna.nombre}". Debe estar vacía.`, textoBoton: 'Eliminar', peligro: true });
            if (!ok) return;
            await App.api(`/api/columnas/${columna.id}`, { method: 'DELETE' });
            App.aviso('Columna eliminada.');
        }
        await cargarTablero();
    } catch (err) { App.error(err); }
});

document.getElementById('btnAgregarColumna').addEventListener('click', () => {
    document.getElementById('formColumna').reset();
    document.getElementById('nombreColumna').classList.remove('is-invalid');
    document.getElementById('errorColumna').textContent = '';
    modalColumna.show();
});
document.getElementById('formColumna').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('nombreColumna');
    if (!nombre.value.trim()) return nombre.classList.add('is-invalid');
    try {
        await App.api(`/api/tableros/${tableroId}/columnas`, {
            method: 'POST', body: { nombre: nombre.value.trim(), tipo: document.getElementById('tipoColumna').value },
        });
        modalColumna.hide();
        App.aviso('Columna agregada.');
        await cargarTablero();
    } catch (err) {
        document.getElementById('errorColumna').textContent = err.message;
    }
});

document.getElementById('btnRenombrarTablero').addEventListener('click', async () => {
    const nombre = await App.pedirTexto({ titulo: 'Renombrar tablero', textoBoton: 'Guardar', campo: { etiqueta: 'Nombre', valor: tablero.tablero.nombre, maximo: 80 } });
    if (!nombre) return;
    try {
        await App.api(`/api/tableros/${tableroId}`, { method: 'PUT', body: { nombre } });
        App.recargarConAviso('Tablero renombrado.');
    } catch (err) { App.error(err); }
});

document.getElementById('btnEliminarTablero').addEventListener('click', async () => {
    const ok = await App.confirmar({
        titulo: 'Eliminar tablero', peligro: true, textoBoton: 'Eliminar tablero',
        mensaje: `Se eliminará "${tablero.tablero.nombre}" con sus ${tablero.tareas.length} tarea(s) e historial. Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    try {
        await App.api(`/api/tableros/${tableroId}`, { method: 'DELETE' });
        App.recargarConAviso('Tablero eliminado.', '/proyectos.html');
    } catch (err) { App.error(err); }
});

document.getElementById('selectorTablero').addEventListener('change', (e) => {
    window.location.href = `/tablero.html?proyecto=${proyectoId}&tablero=${e.target.value}`;
});
['filtroTexto', 'filtroTipo', 'filtroPrioridad', 'filtroResponsable', 'filtroVencidas'].forEach(id =>
    document.getElementById(id).addEventListener(id === 'filtroTexto' ? 'input' : 'change', pintarKanban));

(async () => {
    if (!tableroId) return (window.location.href = '/proyectos.html');
    try {
        await App.listo;
        if (App.estado.esAdmin) document.getElementById('menuAdminTablero').classList.remove('d-none');
        await cargarTablero();
        const tareaInicial = Number(App.parametro('tarea'));
        if (tareaInicial) abrirTarea(tareaInicial);
    } catch (e) {
        kanban.innerHTML = `<div class="card w-100"><div class="estado-vacio"><h3>No se pudo abrir el tablero</h3><p class="mb-0">${esc(e.message)}</p></div></div>`;
    }
})();
