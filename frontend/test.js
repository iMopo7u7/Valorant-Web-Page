<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Actualizar Riot ID</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; }
    label, input, button { display: block; margin: 10px 0; width: 100%; }
    button { padding: 10px; }
    .message { margin-top: 10px; }
  </style>
</head>
<body>
  <h2>Actualizar Riot ID</h2>

  <label for="riotIdInput">Riot ID:</label>
  <input type="text" id="riotIdInput" placeholder="Ingresa tu Riot ID">

  <button id="saveBtn">Guardar</button>

  <div class="message" id="message"></div>

  <script>
    const riotInput = document.getElementById('riotIdInput');
    const saveBtn = document.getElementById('saveBtn');
    const messageDiv = document.getElementById('message');

    // Cargar Riot ID actual
    async function loadUser() {
      try {
        const res = await fetch('https://valorant-10-mans.onrender.com/api/users/me', {
          credentials: 'include'
        });
        if (!res.ok) throw new Error('No autorizado o sesión expirada');

        const user = await res.json();
        if (user.riotId) {
          riotInput.value = user.riotId;
        }
      } catch (err) {
        messageDiv.textContent = 'Error cargando usuario: ' + err.message;
        messageDiv.style.color = 'red';
      }
    }

    // Guardar Riot ID
    async function saveRiot() {
      const riotId = riotInput.value.trim();
      if (!riotId) {
        messageDiv.textContent = 'Ingresa un Riot ID';
        messageDiv.style.color = 'red';
        return;
      }

      try {
        const res = await fetch('https://valorant-10-mans.onrender.com/api/users/update-riot', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ riotId })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error desconocido');

        messageDiv.textContent = 'Riot ID actualizado correctamente ✅';
        messageDiv.style.color = 'green';
      } catch (err) {
        messageDiv.textContent = 'Error guardando Riot ID: ' + err.message;
        messageDiv.style.color = 'red';
      }
    }

    saveBtn.addEventListener('click', saveRiot);

    loadUser();
  </script>
</body>
</html>
