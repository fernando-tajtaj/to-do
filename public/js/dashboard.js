// Inicio: indicadores, resumen por proyecto, reporte por estado y listas de seguimiento
const { escaparHtml: esc } = App;
let datos = null;
let grafica = null;

function enlaceTarea(t) {
    return `/tablero.html?proyecto=${t.proyecto_id}&tablero=${t.tablero_id}&tarea=${t.id}`;
}

function pintarIndicadores(r) {
    const pct = (n) => (r.total ? Math.round((n / r.total) * 100) : 0);
    const tiles = [
        { etiqueta: 'Total de tareas', valor: r.total, detalle: `Bugs abiertos: ${r.bugs_abiertos}` },
        { etiqueta: 'Por hacer', valor: r.por_hacer, detalle: `${pct(r.por_hacer)}% del total` },
        { etiqueta: 'En progreso', valor: r.en_progreso, detalle: `${pct(r.en_progreso)}% del total` },
        { etiqueta: 'En revisión / QA', valor: r.en_revision, detalle: `${pct(r.en_revision)}% del total` },
        { etiqueta: 'Completadas', valor: r.completado, detalle: `${pct(r.completado)}% del total` },
        { etiqueta: 'Vencidas', valor: r.vencidas, detalle: 'Fecha límite superada', alerta: r.vencidas > 0 },
    ];
    document.getElementById('indicadores').innerHTML = tiles.map(t => `
        <div class="col-6 col-md-4 col-xl-2">
            <div class="card kpi ${t.alerta ? 'alerta' : ''}">
                <div class="etiqueta">${t.etiqueta}</div>
                <div class="valor">${t.valor}</div>
                <div class="detalle">${t.detalle}</div>
            </div>
        </div>`).join('');
}

function pintarTablaProyectos(proyectos) {
    const contenedor = document.getElementById('tablaProyectos');
    if (!proyectos.length) {
        contenedor.innerHTML = `<div class="estado-vacio"><h3>No hay proyectos</h3>
            <p class="mb-0">${App.estado.esAdmin ? 'Crea el primer proyecto desde la sección Proyectos.' : 'Pide a un Administrador que te asigne a un proyecto.'}</p></div>`;
        return;
    }
    contenedor.innerHTML = `
        <table class="tabla-ui">
            <thead><tr>
                <th>Proyecto</th><th class="num">Total</th><th class="num">Por hacer</th><th class="num">En progreso</th>
                <th class="num">En revisión</th><th class="num">Completadas</th><th class="num">Vencidas</th><th style="width:120px">Avance</th>
            </tr></thead>
            <tbody>${proyectos.map(p => {
                const r = p.resumen;
                return `<tr>
                    <td><a href="/proyectos.html#proyecto-${p.id}" class="fw-semibold">${esc(p.nombre)}</a></td>
                    <td class="num">${r.total}</td><td class="num">${r.por_hacer}</td><td class="num">${r.en_progreso}</td>
                    <td class="num">${r.en_revision}</td><td class="num">${r.completado}</td>
                    <td class="num ${r.vencidas ? 'text-critical fw-semibold' : ''}">${r.vencidas}</td>
                    <td><div class="d-flex align-items-center gap-2"><div class="progreso flex-grow-1"><div style="width:${r.avance}%"></div></div>
                        <span class="small text-secondary-ui">${r.avance}%</span></div></td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
}

function pintarLista(id, tareas, vacio, detalle) {
    const lista = document.getElementById(id);
    lista.innerHTML = tareas.length ? tareas.map(t => `
        <li>
            <a href="${enlaceTarea(t)}" class="fw-semibold d-block text-truncate">${esc(t.titulo)}</a>
            <div class="meta d-flex flex-wrap gap-2 mt-1">${detalle(t)}</div>
        </li>`).join('') : `<li class="text-muted">${vacio}</li>`;
}

function pintarActividad(actividad) {
    const lista = document.getElementById('listaActividad');
    lista.innerHTML = actividad.length ? actividad.map(a => `
        <li>
            <div><strong>${esc(a.usuario || 'Sistema')}</strong> <span class="text-secondary-ui">${esc(a.accion)}</span></div>
            <div class="meta mt-1">${esc(a.titulo)} · ${esc(a.proyecto)} · ${App.fechaHora(a.fecha)}</div>
        </li>`).join('') : '<li class="text-muted">Sin actividad registrada.</li>';
}

// ── Reporte con filtros ──────────────────────────────────────────────────
function prepararFiltros(tareas) {
    const alcance = document.getElementById('filtroAlcance');
    const responsable = document.getElementById('filtroResponsable');
    const proyectos = new Map();
    const usuarios = new Map();
    for (const t of tareas) {
        if (!proyectos.has(t.proyecto_id)) proyectos.set(t.proyecto_id, { nombre: t.proyecto_nombre, tableros: new Map() });
        proyectos.get(t.proyecto_id).tableros.set(t.tablero_id, t.tablero_nombre);
        if (t.responsable_id) usuarios.set(t.responsable_id, t.responsable_nombre);
    }
    // Valores con prefijo explícito: "p:" proyecto, "t:" tablero, "u:" usuario, "rol:" rol
    alcance.innerHTML = '<option value="">Todos los proyectos</option>' +
        [...proyectos].map(([id, p]) => `<option value="p:${id}">${esc(p.nombre)}</option>` +
            [...p.tableros].map(([tid, nombre]) => `<option value="t:${tid}">&nbsp;&nbsp;— ${esc(nombre)}</option>`).join('')).join('');
    responsable.innerHTML = `<option value="">Todos los responsables</option>
        <option value="rol:Administrador">Solo Administradores</option>
        <option value="rol:Miembro/Colaborador">Solo Colaboradores</option>
        <option value="ninguno">Sin responsable</option>` +
        [...usuarios].map(([id, nombre]) => `<option value="u:${id}">${esc(nombre)}</option>`).join('');
    alcance.addEventListener('change', pintarReporte);
    responsable.addEventListener('change', pintarReporte);
}

function filtrarTareas() {
    const [tipoAlcance, idAlcance] = document.getElementById('filtroAlcance').value.split(':');
    const responsable = document.getElementById('filtroResponsable').value;
    const [tipoResp, valorResp] = responsable.split(/:(.+)/);
    return datos.tareas.filter(t => {
        if (tipoAlcance === 'p' && t.proyecto_id !== Number(idAlcance)) return false;
        if (tipoAlcance === 't' && t.tablero_id !== Number(idAlcance)) return false;
        if (tipoResp === 'rol' && t.responsable_rol !== valorResp) return false;
        if (tipoResp === 'u' && t.responsable_id !== Number(valorResp)) return false;
        if (responsable === 'ninguno' && t.responsable_id) return false;
        return true;
    });
}

// Escribe el valor al final de cada barra (etiqueta directa)
const etiquetasValor = {
    id: 'etiquetasValor',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = '#303030';
        ctx.textBaseline = 'middle';
        chart.getDatasetMeta(0).data.forEach((barra, i) => {
            ctx.fillText(chart.data.datasets[0].data[i], barra.x + 6, barra.y);
        });
        ctx.restore();
    },
};

function pintarReporte() {
    const tareas = filtrarTareas();
    const conteo = Object.keys(App.ESTADOS).map(tipo => tareas.filter(t => t.estado_tipo === tipo).length);
    document.getElementById('reporteVencidas').textContent = tareas.filter(t => t.vencida).length;
    document.getElementById('reporteBugs').textContent = tareas.filter(t => t.tipo === 'Bug' && t.estado_tipo !== 'completado').length;
    document.getElementById('reporteTotal').textContent = tareas.length;

    if (grafica) {
        grafica.data.datasets[0].data = conteo;
        grafica.update();
        return;
    }
    grafica = new Chart(document.getElementById('graficaEstados'), {
        type: 'bar',
        data: {
            labels: Object.values(App.ESTADOS),
            datasets: [{ label: 'Tareas', data: conteo, backgroundColor: '#2c6ecb', borderRadius: 4, barThickness: 20 }],
        },
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            layout: { padding: { right: 28 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a', padding: 8, displayColors: false,
                    callbacks: { label: (c) => `${c.parsed.x} tarea(s)` },
                },
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0, color: '#8a8a8a' }, grid: { color: '#ebebeb' }, border: { display: false } },
                y: { ticks: { color: '#303030', font: { family: 'Inter', size: 12 } }, grid: { display: false }, border: { display: false } },
            },
        },
        plugins: [etiquetasValor],
    });
}

(async () => {
    try {
        await App.listo;
        const { usuario, esAdmin } = App.estado;
        document.getElementById('saludo').textContent =
            `Hola, ${usuario.nombre.split(' ')[0]}. Este es el estado de ${esAdmin ? 'todos los proyectos' : 'tus proyectos'}.`;
        if (esAdmin) document.getElementById('accionesInicio').innerHTML =
            '<a class="btn btn-primary" href="/proyectos.html?nuevo=1">Nuevo proyecto</a>';

        datos = await App.api('/api/dashboard');
        pintarIndicadores(datos.resumen);
        pintarTablaProyectos(datos.proyectos);
        pintarLista('listaMias', datos.mias, 'No tienes tareas abiertas asignadas.',
            t => `${App.insigniaEstado(t.estado_tipo)} <span>${esc(t.proyecto_nombre)}</span>${t.fecha_limite ? `<span class="${t.vencida ? 'text-critical fw-semibold' : ''}">Vence ${App.fecha(t.fecha_limite)}</span>` : ''}`);
        pintarLista('listaVencidas', datos.vencidas, 'No hay tareas vencidas.',
            t => `<span class="text-critical fw-semibold">Venció ${App.fecha(t.fecha_limite)}</span><span>${esc(t.responsable_nombre || 'Sin responsable')}</span><span>${esc(t.proyecto_nombre)}</span>`);
        pintarActividad(datos.actividad);
        prepararFiltros(datos.tareas);
        pintarReporte();
    } catch (e) {
        App.error(e);
    }
})();
