# Focus Mastery

Web pública de accountability: pomodoros públicos, mínimo 3 buddies y un check diario mutuo.

- **Público** (cualquiera con el enlace, sin cuenta): perfil, pomodoros, objetivos cumplidos (solo números), check-in y nota del día, buddies.
- **Privado** (solo tú): tablero de tareas, texto de los objetivos y diario.

Es una web estática (HTML + JS, sin instalar nada) con [Supabase](https://supabase.com) como base de datos y sistema de cuentas. Las dos cosas tienen plan gratuito.

## Puesta en marcha (unos 20 minutos)

### 1. Crea la base de datos
1. Crea una cuenta en supabase.com y un proyecto nuevo (región: Europa).
2. Ve a **SQL Editor → New query**, pega todo `supabase/schema.sql` y pulsa **Run**.

### 2. Conecta la web
1. En Supabase: **Project Settings → API**.
2. Copia **Project URL** y **anon public key** en `config.js`.
   La anon key es pública por diseño; lo que protege los datos son las reglas del `schema.sql`.

### 3. Pruébala en tu ordenador
```bash
cd focus-mastery-web && python3 -m http.server 8000
```
Abre http://localhost:8000. Antes, en Supabase → **Authentication → URL Configuration**, añade `http://localhost:8000` a **Redirect URLs**.

### 4. Publícala
La opción más fácil es **Netlify Drop**: entra en app.netlify.com/drop y arrastra la carpeta `focus-mastery-web`. Te da una URL tipo `https://focus-mastery-xyz.netlify.app` (puedes cambiar el nombre en Site settings).

Después, en Supabase → **Authentication → URL Configuration**:
- **Site URL**: tu URL de Netlify
- **Redirect URLs**: añade también tu URL de Netlify

Alternativa: GitHub Pages (sube la carpeta a un repo y activa Pages).

## Cosas que conviene saber
- **Emails de acceso**: Supabase gratis envía pocos emails por hora (pensado para pruebas). Para tu grupo de amigos basta. Si se abre a mucha gente, configura un SMTP propio (por ejemplo, Resend, gratis hasta 3 000 emails al mes) en Authentication → SMTP.
- **Pausa por inactividad**: los proyectos gratuitos de Supabase se pausan tras 7 días sin uso. Si lo usáis a diario, no pasa.
- **Privacidad**: tus tareas, objetivos y diario solo los puede leer tu cuenta (Row Level Security). Tú, como administradora del proyecto de Supabase, técnicamente puedes ver todos los datos desde el panel. Tenlo en cuenta si invitas a gente.
- **Acceso**: email + contraseña (mínimo 8 caracteres). Al crear la cuenta llega un email de confirmación. También se puede entrar con un enlace por email, recuperar la contraseña olvidada y cambiarla desde Hoy → Tu perfil. Los enlaces de los emails hay que abrirlos en el mismo navegador donde se pidieron.
- Para exigir contraseñas más fuertes: Supabase → Authentication → Providers → Email → *Minimum password length* / *Password requirements*.

## Archivos
- `index.html`: estructura de la página
- `styles.css`: diseño
- `app.js`: toda la lógica (vistas, temporizador, buddies, check-ins)
- `config.js`: tus claves de Supabase
- `supabase/schema.sql`: tablas y reglas de seguridad
