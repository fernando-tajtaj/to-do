// RESTABLECER CONTRASEÑA (página abierta desde el enlace del correo)
const mensajeAlerta = document.getElementById('mensajeAlerta');
const formulario = document.getElementById('restablecerForm');
const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
    mostrarMensaje('Enlace inválido. Solicita nuevamente la recuperación.', 'danger');
    formulario.querySelector('button').disabled = true;
}

formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('passwordNueva').value;
    const confirmar = document.getElementById('passwordConfirmar').value;

    if (password !== confirmar) {
        mostrarMensaje('Las contraseñas no coinciden.', 'danger');
        return;
    }

    const regexFuerte = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!regexFuerte.test(password)) {
        mostrarMensaje('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.', 'danger');
        return;
    }

    try {
        const res = await fetch('/api/restablecer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password })
        });
        const data = await res.json();
        if (res.ok) {
            mostrarMensaje(data.mensaje + ' Redirigiendo...', 'success');
            formulario.reset();
            setTimeout(() => window.location.href = '/index.html', 2000);
        } else {
            mostrarMensaje(data.error, 'danger');
        }
    } catch (error) {
        mostrarMensaje('Error al conectar con el servidor.', 'danger');
    }
});

function mostrarMensaje(texto, tipo) {
    mensajeAlerta.className = `mensaje-formulario ${tipo === 'success' ? 'exito' : 'error'}`;
    mensajeAlerta.textContent = texto;
}
