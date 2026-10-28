// Gestión de usuarios (solo Administrador): rol, estado de la cuenta y alta de usuarios
const { escaparHtml: esc } = App;
const modalUsuario = new bootstrap.Modal(document.getElementById('modalUsuario'));
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_PASSWORD = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
let usuarios = [];

function pintar() {
    const filtro = document.getElementById('buscarUsuario').value.trim().toLowerCase();
    const yo = App.estado.usuario.id;
    const lista = usuarios.filter(u => !filtro || u.nombre.toLowerCase().includes(filtro) || u.correo.toLowerCase().includes(filtro));
    document.getElementById('tablaUsuarios').innerHTML = lista.length ? `
        <table class="tabla-ui">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Proyectos</th><th class="num">Tareas asignadas</th></tr></thead>
            <tbody>${lista.map(u => `
                <tr data-id="${u.id}">
                    <td><div class="d-flex align-items-center gap-2">
                        <span class="avatar">${esc(App.iniciales(u.nombre))}</span>
                        <div><div class="fw-semibold">${esc(u.nombre)}${u.id === yo ? ' <span class="text-muted fw-normal">(tú)</span>' : ''}</div>
                        <div class="text-muted small">${esc(u.correo)}</div></div></div></td>
                    <td><select class="form-select form-select-sm w-auto" data-campo="rol" ${u.id === yo ? 'disabled' : ''} aria-label="Rol de ${esc(u.nombre)}">
                        <option ${u.rol === 'Miembro/Colaborador' ? 'selected' : ''}>Miembro/Colaborador</option>
                        <option ${u.rol === 'Administrador' ? 'selected' : ''}>Administrador</option>
                    </select></td>
                    <td><div class="form-check form-switch m-0">
                        <input class="form-check-input" type="checkbox" role="switch" data-campo="activo" id="activo${u.id}" ${u.activo ? 'checked' : ''} ${u.id === yo ? 'disabled' : ''}>
                        <label class="form-check-label" for="activo${u.id}">${u.activo ? '<span class="insignia exito">Activo</span>' : '<span class="insignia">Inactivo</span>'}</label>
                    </div></td>
                    <td class="small">${u.rol === 'Administrador' ? '<span class="text-muted">Todos (Administrador)</span>' : esc(u.proyectos || '—')}</td>
                    <td class="num">${u.tareas_asignadas}</td>
                </tr>`).join('')}</tbody>
        </table>` : '<div class="estado-vacio">No hay usuarios que coincidan.</div>';
}

async function cargar() {
    usuarios = await App.api('/api/usuarios');
    pintar();
}

document.getElementById('tablaUsuarios').addEventListener('change', async (e) => {
    const control = e.target.closest('[data-campo]');
    if (!control) return;
    const id = Number(control.closest('tr').dataset.id);
    const u = usuarios.find(x => x.id === id);
    const cambio = control.dataset.campo === 'rol' ? { rol: control.value } : { activo: control.checked };
    if (cambio.activo === false) {
        const ok = await App.confirmar({ titulo: 'Desactivar cuenta', mensaje: `${u.nombre} no podrá iniciar sesión. Su historial se conserva.`, textoBoton: 'Desactivar', peligro: true });
        if (!ok) return pintar();
    }
    try {
        await App.api(`/api/usuarios/${id}`, { method: 'PUT', body: cambio });
        App.aviso('Usuario actualizado.');
    } catch (err) { App.error(err); }
    cargar().catch(App.error);
});

document.getElementById('buscarUsuario').addEventListener('input', pintar);

document.getElementById('btnNuevoUsuario').addEventListener('click', () => {
    document.getElementById('formUsuario').reset();
    document.getElementById('errorUsuario').textContent = '';
    modalUsuario.show();
});
document.getElementById('modalUsuario').addEventListener('shown.bs.modal', () => document.getElementById('usuNombre').focus());

document.getElementById('formUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = {
        nombre: document.getElementById('usuNombre').value.trim(),
        correo: document.getElementById('usuCorreo').value.trim(),
        password: document.getElementById('usuPassword').value,
        rol: document.getElementById('usuRol').value,
    };
    const error = document.getElementById('errorUsuario');
    if (!datos.nombre || !datos.correo || !datos.password) return (error.textContent = 'Todos los campos son obligatorios.');
    if (!REGEX_CORREO.test(datos.correo)) return (error.textContent = 'El formato del correo no es válido.');
    if (!REGEX_PASSWORD.test(datos.password)) return (error.textContent = 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.');
    try {
        await App.api('/api/usuarios', { method: 'POST', body: datos });
        modalUsuario.hide();
        App.aviso('Usuario creado. Asígnalo a un proyecto desde Proyectos.');
        await cargar();
    } catch (err) { error.textContent = err.message; }
});

(async () => {
    try {
        await App.listo;
        if (!App.estado.esAdmin) return (window.location.href = '/dashboard.html');
        await cargar();
    } catch (e) { App.error(e); }
})();
