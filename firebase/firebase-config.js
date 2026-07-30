// Configuration Firebase pour Yellow Dot
//
// IMPORTANT : ce fichier n'est plus importé au chargement de la page.
// Il n'est chargé que lorsque le joueur clique sur "Jouer en ligne"
// (voir js/online.js -> connectFirebase()). Ainsi, si Firebase est
// indisponible (réseau bloqué, bloqueur de pub, etc.), le reste du
// jeu (Solo, Stats, Règles, Paramètres) continue de fonctionner
// normalement au lieu de planter toute la page.
export const firebaseConfig = {
    apiKey: "AIzaSyCZwPWMmN1I5hdVYQEkj_PtUCaHYJTdptQ",
    authDomain: "yellowdotchampiona.firebaseapp.com",
    databaseURL: "https://yellowdotchampiona-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "yellowdotchampiona",
    storageBucket: "yellowdotchampiona.firebasestorage.app",
    messagingSenderId: "149651594411",
    appId: "1:149651594411:web:09a21c1484ac3cb767ebee",
    measurementId: "G-CM4BWNR1SY"
};

export async function loadFirebase() {
    const [{ initializeApp }, dbModule] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js")
    ]);
    const app = initializeApp(firebaseConfig);
    const db = dbModule.getDatabase(app);
    return { db, dbModule };
}
