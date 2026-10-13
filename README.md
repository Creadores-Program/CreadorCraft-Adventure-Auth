# CreadorCraft Adventure - Auth & Binary API
API backend oficial y sistema de autenticación para **CreadorCraft Adventure**, optimizada para la máxima eficiencia mediante transferencia de datos binarios puros (`application/octet-stream`), diseñada para soportar dispositivos retro (J2ME / MIDP 2.0) y modernos (Android / PC).
---
## 🛠️ Stack Tecnológico
* **Node.js** & **Express**: Servidor HTTP de alto rendimiento.
* **PostgreSQL (`pg`)**: Base de datos relacional para almacenamiento persistente y atómico de cuentas y tokens.
* **Discord.js**: Integración de bot para el sistema de inicio de sesión seguro (`/login`) y eliminación de cuentas (`/deletelogin`).
* **Criptografía Nativa (`crypto`)**: Generación segura de MasterTokens (32 bytes) y tickets temporales (6 bytes).
* **Seguridad de Red**: Protección anti-spam con `express-rate-limit` adaptada a respuestas binarias y soporte para CORS.
---
## 📚 Documentación del Protocolo de Red
La especificación completa del protocolo binario de red, estructura de paquetes (`DataPackets`), tipos de datos y flujos de juego se encuentra alojada en el siguiente repositorio oficial:
👉 **[CreadorCraft Adventure Protocol Documentation](https://github.com/Creadores-Program/CreadorCraft-Adventure-Protocol-Doc/)**
---
## 🚀 Endpoints de la API (Binario Puro)
Todos los endpoints de autenticación operan estrictamente bajo peticiones binarias mediante `application/octet-stream`:
* **`POST /wakeup`**: Endpoint de activación para mantener activo el servicio (ej. en Render), respondiendo un único byte (`0x01`).
* **`POST /login`**: Canjea el código temporal de 6 bytes generado por el bot de Discord por un `MasterToken` permanente de 32 bytes.
* **`POST /get-ticket`**: Valida el `MasterToken` de 32 bytes y la IP del servidor de juego para emitir un ticket temporal de 6 bytes (válido por 12 segundos).
* **`POST /verify-ticket`**: Utilizado por los servidores de juego para verificar el ticket de 6 bytes y obtener de forma segura el `discordId` y el nombre de usuario del jugador.
---
## ⚙️ Variables de Entorno Requeridas
Para desplegar y ejecutar este proyecto correctamente (en local o en Render), debes configurar las siguientes variables de entorno:

| Variable | Descripción |
| :--- | :--- |
| `DATABASE_URL` | Cadena de conexión completa a tu base de datos PostgreSQL. |
| `DISCORD_BOT_TOKEN` | Token secreto de autenticación de tu aplicación en el Discord Developer Portal. |
| `PORT` *(Opcional)* | Puerto de escucha del servidor (asignado automáticamente por Render). |

---
## 📦 Despliegue en Render
1. Crea un nuevo **Web Service** en Render conectado a este repositorio.
2. Configura los comandos de compilación y ejecución:
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
3. Añade las variables de entorno (`DATABASE_URL` y `DISCORD_BOT_TOKEN`) en el panel de configuración de Render.
