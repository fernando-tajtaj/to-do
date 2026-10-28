// ============================================================================
// layout.js: estructura común de las páginas internas (barra superior + sidebar)
// y utilidades compartidas: llamadas al API, avisos, confirmaciones y formatos.
// Cada página interna tiene <main class="pagina" data-nav="..."> y espera App.listo.
// ============================================================================
const App = (() => {
    const ESTADOS = {
        por_hacer: 'Por hacer',
        en_progreso: 'En progreso',
        en_revision: 'En revisión / QA',
        completado: 'Completado',
    };

    function escaparHtml(texto) {
        return String(texto ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    // fetch con JSON; lanza Error con el mensaje del servidor si la respuesta falla
    async function api(url, opciones = {}) {
        const config = { method: opciones.method || 'GET', headers: {} };
        if (opciones.body !== undefined) {
            config.headers['Content-Type'] = 'application/json';
            config.body = JSON.stringify(opciones.body);
        }
        let res;
        try {
            res = await fetch(url, config);
        } catch (e) {
            throw new Error('No se pudo conectar con el servidor.');
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && !opciones.sinRedireccion) {
            window.location.href = '/';
            throw new Error(data.error || 'Sesión expirada.');
        }
        if (!res.ok) throw new Error(data.error || 'Ocurrió un error inesperado.');
        return data;
    }

    // ── Avisos (toasts) ───────────────────────────────────────────────────
    function aviso(mensaje, tipo = 'exito') {
        let contenedor = document.getElementById('contenedorAvisos');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'contenedorAvisos';
            contenedor.className = 'toast-container position-fixed bottom-0 start-50 translate-middle-x p-3';
            document.body.appendChild(contenedor);
        }
        const el = document.createElement('div');
        el.className = `toast align-items-center ${tipo === 'error' ? 'error' : ''}`;
        el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
        el.innerHTML = `<div class="d-flex"><div class="toast-body"></div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button></div>`;
        el.querySelector('.toast-body').textContent = mensaje;
        contenedor.appendChild(el);
        const toast = new bootstrap.Toast(el, { delay: tipo === 'error' ? 6000 : 3000 });
        el.addEventListener('hidden.bs.toast', () => el.remove());
        toast.show();
    }
    const error = (e) => aviso(e && e.message ? e.message : String(e), 'error');

    // Recarga la página (para refrescar el sidebar) y muestra el aviso al volver
    function recargarConAviso(mensaje, url) {
        try { sessionStorage.setItem('avisoPendiente', mensaje); } catch (e) {}
        if (url) window.location.href = url; else window.location.reload();
    }
    function mostrarAvisoPendiente() {
        try {
            const mensaje = sessionStorage.getItem('avisoPendiente');
            if (mensaje) { sessionStorage.removeItem('avisoPendiente'); aviso(mensaje); }
        } catch (e) {}
    }

    // ── Diálogo reutilizable (confirmar / pedir texto) ────────────────────
    function crearDialogo() {
        let el = document.getElementById('dialogoApp');
        if (el) return el;
        el = document.createElement('div');
        el.className = 'modal fade';
        el.id = 'dialogoApp';
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <form class="modal-content" novalidate>
                    <div class="modal-header">
                        <h2 class="modal-title" id="dialogoTitulo"></h2>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-0" id="dialogoMensaje"></p>
                        <div id="dialogoCampo" class="mt-3 d-none">
                            <label class="form-label" for="dialogoEntrada" id="dialogoEtiqueta"></label>
                            <div id="dialogoEntradaContenedor"></div>
                            <div class="invalid-feedback" id="dialogoError">Este campo es obligatorio.</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secundario" data-bs-dismiss="modal">Cancelar</button>
                        <button type="submit" class="btn btn-primary" id="dialogoAceptar">Aceptar</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(el);
        return el;
    }

    function dialogo({ titulo, mensaje = '', textoBoton = 'Aceptar', peligro = false, campo = null }) {
        const el = crearDialogo();
        el.querySelector('#dialogoTitulo').textContent = titulo;
        el.querySelector('#dialogoMensaje').textContent = mensaje;
        el.querySelector('#dialogoMensaje').classList.toggle('d-none', !mensaje);
        const boton = el.querySelector('#dialogoAceptar');
        boton.textContent = textoBoton;
        boton.className = `btn ${peligro ? 'btn-danger' : 'btn-primary'}`;

        const zonaCampo = el.querySelector('#dialogoCampo');
        let entrada = null;
        zonaCampo.classList.toggle('d-none', !campo);
        if (campo) {
            el.querySelector('#dialogoEtiqueta').textContent = campo.etiqueta;
            el.querySelector('#dialogoEntradaContenedor').innerHTML = campo.multilinea
                ? '<textarea class="form-control" id="dialogoEntrada" rows="3"></textarea>'
                : '<input type="text" class="form-control" id="dialogoEntrada" autocomplete="off">';
            entrada = el.querySelector('#dialogoEntrada');
            entrada.value = campo.valor || '';
            entrada.maxLength = campo.maximo || 1000;
            entrada.addEventListener('input', () => entrada.classList.remove('is-invalid'));
        }

        const modal = bootstrap.Modal.getOrCreateInstance(el);
        return new Promise(resolve => {
            let resultado = campo ? null : false;
            const form = el.querySelector('form');
            form.onsubmit = (e) => {
                e.preventDefault();
                if (campo) {
                    const valor = entrada.value.trim();
                    if (campo.requerido !== false && !valor) { entrada.classList.add('is-invalid'); return; }
                    resultado = valor;
                } else resultado = true;
                modal.hide();
            };
            el.addEventListener('shown.bs.modal', () => (entrada || boton).focus(), { once: true });
            el.addEventListener('hidden.bs.modal', () => resolve(resultado), { once: true });
            modal.show();
        });
    }
    const confirmar = (opciones) => dialogo(opciones);
    const pedirTexto = (opciones) => dialogo({ ...opciones, campo: opciones.campo || { etiqueta: '' } });

    // ── Formatos ──────────────────────────────────────────────────────────
    function fecha(valor) {
        if (!valor) return '';
        const d = new Date(valor.length === 10 ? valor + 'T00:00:00' : valor);
        return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    // Las fechas de SQLite (CURRENT_TIMESTAMP) vienen en UTC
    function fechaHora(valor) {
        if (!valor) return '';
        const d = new Date(valor.includes('T') ? valor : valor.replace(' ', 'T') + 'Z');
        return d.toLocaleString('es-GT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function iniciales(nombre) {
        return String(nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    }
    function insigniaEstado(tipo, nombre) {
        const clase = { por_hacer: '', en_progreso: 'info', en_revision: 'advertencia', completado: 'exito' }[tipo] || '';
        return `<span class="insignia ${clase}"><span class="punto"></span>${escaparHtml(nombre || ESTADOS[tipo] || tipo)}</span>`;
    }
    function insigniaPrioridad(prioridad) {
        const clase = { Alta: 'critico', Media: 'atencion', Baja: 'contorno' }[prioridad] || 'contorno';
        return `<span class="insignia ${clase}">${escaparHtml(prioridad)}</span>`;
    }
    const parametro = (nombre) => new URLSearchParams(window.location.search).get(nombre);

    // ── Estructura: barra superior y sidebar ──────────────────────────────
    function pintarEstructura(usuario, proyectos) {
        const main = document.querySelector('main.pagina');
        const nav = main.dataset.nav;
        const proyectoActual = Number(main.dataset.proyecto || parametro('proyecto')) || null;
        const tableroActual = Number(parametro('tablero')) || null;
        const esAdmin = usuario.rol === 'Administrador';

        const enlacesProyectos = proyectos.map(p => {
            const activo = p.id === proyectoActual;
            const tableros = activo ? `<div class="nav-sub">${p.tableros.map(t => `
                <a class="nav-link ${t.id === tableroActual ? 'active' : ''}" href="/tablero.html?proyecto=${p.id}&tablero=${t.id}">${escaparHtml(t.nombre)}</a>`).join('')}</div>` : '';
            const destino = p.tableros.length ? `/tablero.html?proyecto=${p.id}&tablero=${p.tableros[0].id}` : '/proyectos.html';
            return `<a class="nav-link ${activo && !tableroActual ? 'active' : ''}" href="${destino}">
                        <span class="punto"></span><span class="text-truncate">${escaparHtml(p.nombre)}</span>
                        <span class="contador">${p.resumen.total}</span></a>${tableros}`;
        }).join('');

        const topbar = document.createElement('header');
        topbar.className = 'topbar';
        topbar.innerHTML = `
            <button class="btn-menu" type="button" id="btnMenu" aria-label="Abrir menú">Menú</button>
            <a class="marca" href="/dashboard.html"><span class="logo">QA</span><span>QA Proyectos</span></a>
            <div class="usuario-chip">
                <span class="avatar">${escaparHtml(iniciales(usuario.nombre))}</span>
                <span class="nombre">${escaparHtml(usuario.nombre)}</span>
            </div>`;

        const sidebar = document.createElement('nav');
        sidebar.className = 'sidebar';
        sidebar.setAttribute('aria-label', 'Navegación principal');
        sidebar.innerHTML = `
            <a class="nav-link ${nav === 'inicio' ? 'active' : ''}" href="/dashboard.html">Inicio</a>
            <a class="nav-link ${nav === 'proyectos' ? 'active' : ''}" href="/proyectos.html">Proyectos</a>
            ${esAdmin ? `<a class="nav-link ${nav === 'usuarios' ? 'active' : ''}" href="/usuarios.html">Usuarios</a>` : ''}
            <div class="nav-seccion">${esAdmin ? 'Todos los proyectos' : 'Mis proyectos'}</div>
            ${enlacesProyectos || '<div class="px-2 text-muted small">Aún no tienes proyectos asignados.</div>'}
            <div class="pie">
                <div class="d-flex align-items-center gap-2 px-1 mb-2">
                    <span class="avatar">${escaparHtml(iniciales(usuario.nombre))}</span>
                    <div class="lh-sm text-truncate">
                        <div class="fw-semibold text-truncate">${escaparHtml(usuario.nombre)}</div>
                        <div class="text-muted small">${escaparHtml(usuario.rol)}</div>
                    </div>
                </div>
                <button class="nav-link w-100 border-0 bg-transparent" type="button" id="btnCerrarSesion">Cerrar sesión</button>
            </div>`;

        const fondo = document.createElement('div');
        fondo.className = 'fondo-menu';

        const contenido = document.createElement('div');
        contenido.className = 'contenido';
        main.parentNode.insertBefore(contenido, main);
        contenido.appendChild(main);
        document.body.prepend(topbar, sidebar, fondo);

        topbar.querySelector('#btnMenu').addEventListener('click', () => document.body.classList.toggle('menu-abierto'));
        fondo.addEventListener('click', () => document.body.classList.remove('menu-abierto'));
        sidebar.querySelector('#btnCerrarSesion').addEventListener('click', async () => {
            await api('/api/logout', { method: 'POST' }).catch(() => {});
            window.location.href = '/';
        });
    }

    const estado = { usuario: null, esAdmin: false, proyectos: [] };

    const listo = (async () => {
        estado.usuario = await api('/api/sesion');
        estado.esAdmin = estado.usuario.rol === 'Administrador';
        estado.proyectos = await api('/api/proyectos');
        pintarEstructura(estado.usuario, estado.proyectos);
        mostrarAvisoPendiente();
        return estado;
    })();

    return {
        ESTADOS, estado, listo, api, aviso, error, recargarConAviso, confirmar, pedirTexto, escaparHtml,
        fecha, fechaHora, iniciales, insigniaEstado, insigniaPrioridad, parametro,
    };
})();
