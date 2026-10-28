// Proyectos: listado en tarjetas o tabla, creación, edición, miembros y tableros
const { escaparHtml: esc } = App;
const listaProyectos = document.getElementById('listaProyectos');
const modalProyecto = new bootstrap.Modal(document.getElementById('modalProyecto'));
const modalMiembros = new bootstrap.Modal(document.getElementById('modalMiembros'));
let proyectos = [];
let usuarios = [];
let proyectoEditando = null;   // null = creando
let proyectoMiembros = null;
let vista = 'cards';
try { vista = localStorage.getItem('vistaProyectos') === 'tabla' ? 'tabla' : 'cards'; } catch (e) {}

function enlaceTablero(p, t) {
    return `/tablero.html?proyecto=${p.id}&tablero=${t.id}`;
}

function resumenInsignias(r) {
    return `
        <span class="insignia">Por hacer ${r.por_hacer}</span>
        <span class="insignia info">En progreso ${r.en_progreso}</span>
        <span class="insignia advertencia">En revisión ${r.en_revision}</span>
        <span class="insignia exito">Completadas ${r.completado}</span>
        ${r.vencidas ? `<span class="insignia critico">Vencidas ${r.vencidas}</span>` : ''}`;
}

function menuAcciones(p) {
    if (!App.estado.esAdmin) return '';
    return `
        <div class="dropdown">
            <button class="btn btn-secundario btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">Más acciones</button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li><button class="dropdown-item" type="button" data-accion="tablero" data-id="${p.id}">Nuevo tablero</button></li>
                <li><button class="dropdown-item" type="button" data-accion="miembros" data-id="${p.id}">Gestionar miembros</button></li>
                <li><button class="dropdown-item" type="button" data-accion="editar" data-id="${p.id}">Editar proyecto</button></li>
                <li><hr class="dropdown-divider"></li>
                <li><button class="dropdown-item peligro" type="button" data-accion="eliminar" data-id="${p.id}">Eliminar proyecto</button></li>
            </ul>
        </div>`;
}

function htmlTarjetas() {
    return `<div class="row g-3">${proyectos.map(p => `
        <div class="col-md-6 col-xl-4" id="proyecto-${p.id}">
            <div class="card h-100">
                <div class="card-body d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-start gap-2">
                        <h3 class="card-titulo text-break">${esc(p.nombre)}</h3>
                        ${menuAcciones(p)}
                    </div>
                    <p class="text-secondary-ui mt-1 mb-2">${esc(p.descripcion || 'Sin descripción')}</p>
                    <div class="text-muted small mb-3">Creado por ${esc(p.creador_nombre || '—')} · ${p.total_miembros} miembro(s)</div>
                    <div class="d-flex flex-wrap gap-1 mb-3">${resumenInsignias(p.resumen)}</div>
                    <div class="d-flex align-items-center gap-2 mb-3">
                        <div class="progreso flex-grow-1"><div style="width:${p.resumen.avance}%"></div></div>
                        <span class="small text-secondary-ui">${p.resumen.avance}% completado</span>
                    </div>
                    <div class="mt-auto">
                        <div class="small fw-semibold mb-1">Tableros</div>
                        ${p.tableros.length ? `<div class="d-flex flex-column gap-1">${p.tableros.map(t => `
                            <a class="btn btn-secundario btn-sm text-start" href="${enlaceTablero(p, t)}">${esc(t.nombre)}</a>`).join('')}</div>`
                            : '<div class="text-muted small">Sin tableros</div>'}
                    </div>
                </div>
            </div>
        </div>`).join('')}</div>`;
}

function htmlTabla() {
    return `
        <div class="card">
            <div class="table-responsive">
                <table class="tabla-ui">
                    <thead><tr>
                        <th>Proyecto</th><th class="num">Miembros</th><th class="num">Total</th><th class="num">Por hacer</th>
                        <th class="num">En progreso</th><th class="num">En revisión</th><th class="num">Completadas</th>
                        <th class="num">Vencidas</th><th style="width:110px">Avance</th><th>Tableros</th>${App.estado.esAdmin ? '<th></th>' : ''}
                    </tr></thead>
                    <tbody>${proyectos.map(p => {
                        const r = p.resumen;
                        return `<tr id="proyecto-${p.id}">
                            <td><div class="fw-semibold">${esc(p.nombre)}</div><div class="text-muted small text-truncate" style="max-width:240px">${esc(p.descripcion || 'Sin descripción')}</div></td>
                            <td class="num">${p.total_miembros}</td><td class="num">${r.total}</td><td class="num">${r.por_hacer}</td>
                            <td class="num">${r.en_progreso}</td><td class="num">${r.en_revision}</td><td class="num">${r.completado}</td>
                            <td class="num ${r.vencidas ? 'text-critical fw-semibold' : ''}">${r.vencidas}</td>
                            <td><div class="d-flex align-items-center gap-2"><div class="progreso flex-grow-1"><div style="width:${r.avance}%"></div></div><span class="small">${r.avance}%</span></div></td>
                            <td>${p.tableros.map(t => `<a class="d-block text-nowrap" href="${enlaceTablero(p, t)}">${esc(t.nombre)}</a>`).join('') || '<span class="text-muted">—</span>'}</td>
                            ${App.estado.esAdmin ? `<td class="text-end">${menuAcciones(p)}</td>` : ''}
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>
        </div>`;
}

function pintar() {
    document.getElementById('btnVistaCards').classList.toggle('active', vista === 'cards');
    document.getElementById('btnVistaTabla').classList.toggle('active', vista === 'tabla');
    if (!proyectos.length) {
        listaProyectos.innerHTML = `<div class="card"><div class="estado-vacio">
            <h3>No hay proyectos</h3>
            <p class="mb-0">${App.estado.esAdmin ? 'Crea el primer proyecto con el botón "Nuevo proyecto".' : 'Aún no perteneces a ningún proyecto. Pide a un Administrador que te asigne.'}</p>
        </div></div>`;
        return;
    }
    listaProyectos.innerHTML = vista === 'tabla' ? htmlTabla() : htmlTarjetas();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'center' });
}

function cambiarVista(nueva) {
    vista = nueva;
    try { localStorage.setItem('vistaProyectos', nueva); } catch (e) {}
    pintar();
}

function listaCasillas(contenedor, seleccionados) {
    const activos = usuarios.filter(u => u.activo);
    contenedor.innerHTML = activos.map(u => `
        <div class="form-check py-1">
            <input class="form-check-input" type="checkbox" value="${u.id}" id="m${contenedor.id}${u.id}"
                ${seleccionados.has(u.id) ? 'checked' : ''} ${u.id === App.estado.usuario.id && contenedor.id === 'listaMiembrosNuevo' ? 'checked disabled' : ''}>
            <label class="form-check-label d-flex justify-content-between gap-2" for="m${contenedor.id}${u.id}">
                <span>${esc(u.nombre)}</span><span class="text-muted small">${esc(u.rol)}</span>
            </label>
        </div>`).join('') || '<div class="text-muted small">No hay usuarios.</div>';
}

function seleccionados(contenedor) {
    return [...contenedor.querySelectorAll('input:checked')].map(c => Number(c.value));
}

// ── Crear / editar proyecto ──────────────────────────────────────────────
function abrirProyecto(proyecto = null) {
    proyectoEditando = proyecto;
    const form = document.getElementById('formProyecto');
    form.reset();
    form.querySelectorAll('.is-invalid').forEach(e => e.classList.remove('is-invalid'));
    document.getElementById('errorProyecto').textContent = '';
    document.getElementById('tituloModalProyecto').textContent = proyecto ? 'Editar proyecto' : 'Nuevo proyecto';
    document.getElementById('btnGuardarProyecto').textContent = proyecto ? 'Guardar cambios' : 'Crear proyecto';
    document.getElementById('zonaMiembrosNuevo').classList.toggle('d-none', !!proyecto);
    if (proyecto) {
        document.getElementById('nombreProyecto').value = proyecto.nombre;
        document.getElementById('descProyecto').value = proyecto.descripcion || '';
    } else {
        listaCasillas(document.getElementById('listaMiembrosNuevo'), new Set([App.estado.usuario.id]));
    }
    modalProyecto.show();
}

document.getElementById('modalProyecto').addEventListener('shown.bs.modal', () => document.getElementById('nombreProyecto').focus());

document.getElementById('formProyecto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('nombreProyecto');
    if (!nombre.value.trim()) { nombre.classList.add('is-invalid'); return; }
    nombre.classList.remove('is-invalid');
    const datos = { nombre: nombre.value.trim(), descripcion: document.getElementById('descProyecto').value.trim() };
    try {
        if (proyectoEditando) {
            await App.api(`/api/proyectos/${proyectoEditando.id}`, { method: 'PUT', body: datos });
            App.recargarConAviso('Proyecto actualizado.');
        } else {
            datos.miembros = seleccionados(document.getElementById('listaMiembrosNuevo'));
            const r = await App.api('/api/proyectos', { method: 'POST', body: datos });
            App.recargarConAviso('Proyecto creado con su Tablero principal.', `/tablero.html?proyecto=${r.id}&tablero=${r.tableroId}`);
        }
    } catch (err) {
        document.getElementById('errorProyecto').textContent = err.message;
    }
});

// ── Miembros ─────────────────────────────────────────────────────────────
async function abrirMiembros(proyecto) {
    proyectoMiembros = proyecto;
    document.getElementById('tituloModalMiembros').textContent = `Miembros de ${proyecto.nombre}`;
    const actuales = await App.api(`/api/proyectos/${proyecto.id}/miembros`);
    listaCasillas(document.getElementById('listaMiembros'), new Set(actuales.map(m => m.id)));
    modalMiembros.show();
}

document.getElementById('formMiembros').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const r = await App.api(`/api/proyectos/${proyectoMiembros.id}/miembros`, {
            method: 'PUT', body: { usuarios: seleccionados(document.getElementById('listaMiembros')) },
        });
        modalMiembros.hide();
        App.recargarConAviso(`Miembros actualizados (${r.total}).`);
    } catch (err) { App.error(err); }
});

// ── Acciones del menú ────────────────────────────────────────────────────
listaProyectos.addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const proyecto = proyectos.find(p => p.id === Number(boton.dataset.id));
    try {
        switch (boton.dataset.accion) {
            case 'editar': abrirProyecto(proyecto); break;
            case 'miembros': await abrirMiembros(proyecto); break;
            case 'tablero': {
                const nombre = await App.pedirTexto({
                    titulo: 'Nuevo tablero', textoBoton: 'Crear tablero',
                    mensaje: `Se creará en "${proyecto.nombre}" con las columnas Por hacer, En progreso, En revisión / QA y Completado.`,
                    campo: { etiqueta: 'Nombre del tablero', maximo: 80 },
                });
                if (!nombre) return;
                const r = await App.api(`/api/proyectos/${proyecto.id}/tableros`, { method: 'POST', body: { nombre } });
                App.recargarConAviso('Tablero creado.', `/tablero.html?proyecto=${proyecto.id}&tablero=${r.id}`);
                break;
            }
            case 'eliminar': {
                const ok = await App.confirmar({
                    titulo: 'Eliminar proyecto', peligro: true, textoBoton: 'Eliminar proyecto',
                    mensaje: `Se eliminarán "${proyecto.nombre}", sus ${proyecto.tableros.length} tablero(s) y ${proyecto.resumen.total} tarea(s) con su historial. Esta acción no se puede deshacer.`,
                });
                if (!ok) return;
                await App.api(`/api/proyectos/${proyecto.id}`, { method: 'DELETE' });
                App.recargarConAviso('Proyecto eliminado.');
                break;
            }
        }
    } catch (err) { App.error(err); }
});

document.getElementById('btnVistaCards').addEventListener('click', () => cambiarVista('cards'));
document.getElementById('btnVistaTabla').addEventListener('click', () => cambiarVista('tabla'));
document.getElementById('btnNuevoProyecto').addEventListener('click', () => abrirProyecto());

(async () => {
    try {
        await App.listo;
        proyectos = App.estado.proyectos;
        if (App.estado.esAdmin) {
            document.getElementById('btnNuevoProyecto').classList.remove('d-none');
            usuarios = await App.api('/api/usuarios');
        } else {
            document.getElementById('subtituloProyectos').textContent = 'Proyectos a los que fuiste asignado';
        }
        pintar();
        if (App.estado.esAdmin && App.parametro('nuevo')) abrirProyecto();
    } catch (e) { App.error(e); }
})();
