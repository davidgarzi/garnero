import _http from "http";
import _url, { pathToFileURL } from "url";
import _fs from "fs";
import _express from "express";
import _dotenv from "dotenv";
import _cors from "cors";
import _fileUpload from "express-fileupload";
import _streamifier from "streamifier";
import _bcrypt from "bcryptjs";
import _jwt from "jsonwebtoken";
import { Server, Socket } from "socket.io";
import OpenAI from "openai";
import axios from 'axios';
const _nodemailer = require("nodemailer");

// Lettura delle password e parametri fondamentali
_dotenv.config({ "path": ".env" });

// Variabili relative a OpenAI
const OPENAI_API_KEY = process.env.api_key_chatgpt;

//irrigazione
let statoIrrigazione = false;
let arrayIstruzioniAutomatica = [];
let mod = -1; // setto a -1 per far capire che lho gia preso 0 quando spengo l'automatico

// Variabili relative a MongoDB ed Express
import { MongoClient, ObjectId } from "mongodb";
const DBNAME = process.env.DBNAME;
const connectionString: string = process.env.connectionStringAtlas;
const PRIVATE_KEY = _fs.readFileSync("./keys/privateKey.pem", "utf8");
const CERTIFICATE = _fs.readFileSync("./keys/certificate.crt", "utf8");
const ENCRYPTION_KEY = _fs.readFileSync("./keys/encryptionKey.txt", "utf8");
const CREDENTIALS = { "key": PRIVATE_KEY, "cert": CERTIFICATE };
const app = _express();

// Creazione ed avvio del server
// app è il router di Express, si occupa di tutta la gestione delle richieste http
const PORT: number = parseInt(process.env.PORT);
let paginaErrore;
const server = _http.createServer(app);
// Il secondo parametro facoltativo ipAddress consente di mettere il server in ascolto su una delle interfacce della macchina, se non lo metto viene messo in ascolto su tutte le interfacce (3 --> loopback e 2 di rete)
server.listen(PORT, () => {
    init();
    console.log(`Il Server è in ascolto sulla porta ${PORT}`);
});

function init() {
    _fs.readFile("./static/error.html", function (err, data) {
        if (err) {
            paginaErrore = `<h1>Risorsa non trovata</h1>`;
        }
        else {
            paginaErrore = data.toString();
        }
    });
}

//********************************************************************************************//
// Routes middleware
//********************************************************************************************//

// 1. Request log
app.use("/", (req: any, res: any, next: any) => {
    console.log(`-----> ${req.method}: ${req.originalUrl}`);
    next();
});

// 2. Gestione delle risorse statiche
// .static() è un metodo di express che ha già implementata la firma di sopra. Se trova il file fa la send() altrimenti fa la next()
app.use("/", _express.static("./static"));

// 3. Lettura dei parametri POST di req["body"] (bodyParser)
// .json() intercetta solo i parametri passati in json nel body della http request
app.use("/", _express.json({ "limit": "50mb" }));
// .urlencoded() intercetta solo i parametri passati in urlencoded nel body della http request
app.use("/", _express.urlencoded({ "limit": "50mb", "extended": true }));

// 4. Aggancio dei parametri del FormData e dei parametri scalari passati dentro il FormData
// Dimensione massima del file = 10 MB
app.use("/", _fileUpload({ "limits": { "fileSize": (10 * 1024 * 1024) } }));

// 5. Log dei parametri GET, POST, PUT, PATCH, DELETE
app.use("/", (req: any, res: any, next: any) => {
    if (Object.keys(req["query"]).length > 0) {
        console.log(`       ${JSON.stringify(req["query"])}`);
    }
    if (Object.keys(req["body"]).length > 0) {
        console.log(`       ${JSON.stringify(req["body"])}`);
    }
    next();
});

// 6. Controllo degli accessi tramite CORS
const corsOptions = {
    origin: function (origin, callback) {
        return callback(null, true);
    },
    credentials: true
};
app.use("/", _cors(corsOptions));

app.post("/api/login", async (req, res, next) => {
    let username = req["body"].username;
    let pwd = req["body"].password;
    console.log(username, pwd)

    const client = new MongoClient(connectionString);
    await client.connect();
    const collection = client.db(DBNAME).collection("utenti");
    let regex = new RegExp(`^${username}$`, "i");
    let rq = collection.findOne({ "username": regex }, { "projection": { "username": 1, "password": 1 } });
    rq.then((dbUser) => {
        if (!dbUser) {
            res.status(401).send("Username non valido");
        }
        else {
            _bcrypt.compare(pwd, dbUser.password, (err, success) => {
                if (err) {
                    res.status(500).send(`Bcrypt compare error: ${err.message}`);
                }
                else {
                    if (!success) {
                        res.status(401).send("Password non valida");
                    }
                    else {
                        let token = createToken(dbUser);
                        console.log(token);
                        res.setHeader("authorization", token);
                        // Fa si che la header authorization venga restituita al client
                        res.setHeader("access-control-expose-headers", "authorization");
                        res.send({ "ris": "ok" });
                    }
                }
            })
        }
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err.message}`));
    rq.finally(() => client.close());
});
app.get("/api/irrigazioneRichiesta", async (req, res, next) => {
    if (statoIrrigazione == true) {
        if (mod == -1)
            res.send("t");
        else
            res.send(mod.toString());
    }
    else {
        if (mod == -1)
            res.send("f");
        else {
            mod = mod + 4;
            res.send(mod.toString());
        }
    }
    mod = -1;

    //alla fine devo poi settare la mod a -1 cosi arduino tiene la modalità passatagli se gli passo la 0 allora lui disattiva
    //devo inviare anche l'arrayIstruzioniAutomatica gli passo semplicemente modalità 1,2,3 e umidità minima e massima se ce lo 0 modalita automatico disattivo
});


const auth = { user: process.env.mail, pass: process.env.password };
const transporter = _nodemailer.createTransport({
    service: 'gmail',
    auth: auth
});

app.post("/api/cambiaPassword", async (req, res, next) => {
    let username = req["body"].username;
    let password = req["body"].newPass;
    password = _bcrypt.hashSync(password, 10);
    console.log(username, password);
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("utenti");
    let rq = collection.updateOne({ "mail": username }, { "$set": { "password": password } });
    rq.then((data) => {
        let mailOptions = {
            from: auth.user,
            to: username,
            subject: 'Cambio password',
            text: `La tua password è: ${req["body"].newPass}`
        };

        transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
                console.log(error);
            } else {
                res.send(data);
            }
        });
        //res.send(data);
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});

app.get("/api/inviadati", async (req, res, next) => {
    //prendo data e ora all'invio del dato pk altrimenti dovrei avere un altro modulo su arduino
    let now = new Date();
    let ora;
    let date = now.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });  // Specifica il fuso orario
    console.log(date);

    // Prende l'ora corrente specificando il fuso orario
    let hours = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

    console.log(hours);

    // Formatta l'ora manualmente se necessario
    let hoursParts = hours.split(':');
    let hour = parseInt(hoursParts[0]);
    let minute = parseInt(hoursParts[1]);

    if (minute < 10) {
        if (minute == 0) {
            ora = hour + ":00";
        } else {
            ora = hour + ":0" + minute;
        }
    } else {
        ora = hour + ":" + minute;
    }

    console.log(ora);

    //prendo il dato e il tipo
    let temp = req["query"].temp;
    let hum = req["query"].hum;
    let humT = req["query"].humT;
    console.log(temp);
    console.log(hum);
    console.log(humT);

    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");
    let rq = collection.find({}).toArray();
    rq.then(async (risposta) => {
        //let aggiungiT: boolean = false;
        //let aggiungiH: boolean = false; 
        if (risposta[1].valori != "") {
            console.log("-------------------------------------------------------------------------------------");
            if (risposta[2].valori[0].data != date) {    //date data di oggi
                console.log("aggiorno storico");
                await aggiornaStorico(risposta, date, res, req);
                await eliminareDatiVecchi(risposta, date, res, req);
            }

            await aggiungoTemperatura(temp, ora, res, date);
            await aggiungoUmidita(hum, ora, res, date);
            await aggiungoUmiditaTerra(humT, ora, res, date);
            res.send("aggiunto");

            //#region Codice controllo se i dati sono uguali
            //NON FACCIO PIU IL CONTROLLO SE CAMBIANO I DATI PER POTER VISUALIZZARE AL MEGLIO I GRAFICI
            // for (let dato of risposta) {
            //     if (dato.tipo == "temperatura") {
            //         if (dato.valori[dato.valori.length - 1].dato == temp)
            //             aggiungiT = false;
            //         else
            //             aggiungiT = true;

            //     }
            //     else if (dato.tipo == "umiditaAria") {
            //         if (dato.valori[dato.valori.length - 1].dato == hum)
            //             aggiungiH = false;
            //         else
            //             aggiungiH = true;
            //     }
            // }


            // if (aggiungiT || aggiungiH) {
            //     await aggiungoTemperatura(temp, ora, res, date);
            //     await aggiungoUmidita(hum, ora, res, date);
            //     res.send("aggiunto");
            // }
            // else {
            //     console.log("dati uguali");
            //     res.send("dati uguali");
            // }
            //#endregion
        }
        else {
            await aggiungoTemperatura(temp, ora, res, date);
            await aggiungoUmidita(hum, ora, res, date);
            await aggiungoUmiditaTerra(humT, ora, res, date);
            res.send("aggiunto");
        }
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());

});

// 11. Controllo del token
app.use("/api/", (req: any, res: any, next: any) => {
    console.log("Controllo tokenccccccccccc");
    console.log(req.headers["authorization"]);
    if (!req.headers["authorization"]) {
        console.log("Token mancante");
        res.status(403).send("Token mancante");
    }
    else {
        let token = req.headers["authorization"];
        _jwt.verify(token, ENCRYPTION_KEY, (err, payload) => {
            if (err) {
                res.status(403).send(`Token non valido: ${err}`);
            }
            else {
                let newToken = createToken(payload);
                console.log(newToken);
                res.setHeader("authorization", newToken);
                // Fa si che la header authorization venga restituita al client
                res.setHeader("access-control-expose-headers", "authorization");
                req["payload"] = payload;
                next();
            }
        });
    }
});

function createToken(data) {
    let currentTimeSeconds = Math.floor(new Date().getTime() / 1000);
    let payload = {
        "_id": data._id,
        "username": data.username,
        // Se c'è iat mette iat altrimenti mette currentTimeSeconds
        "iat": data.iat || currentTimeSeconds,
        "exp": currentTimeSeconds + parseInt(process.env.TOKEN_EXPIRE_DURATION)
    }
    let token = _jwt.sign(payload, ENCRYPTION_KEY);
    return token;
}

//********************************************************************************************//
// Routes finali di risposta al client
//********************************************************************************************//

app.post("/api/dati", async (req, res, next) => {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");
    let rq = collection.find({}).toArray();
    rq.then((data) => {
        if (!data) {
            res.status(401).send("Not found");
        }
        else {
            res.send(data);
        }
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});

app.post("/api/domanda", async (req, res, next) => {
    let domanda = req["body"].domanda;
    console.log(domanda);
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            {
                "role": "system",
                "content": "Sei un esperto in tutto l'ambito meteorologico, il calendario lunare e agricoltura quindi devi rispondere alle domande in modo super preciso. prendi come zona climatica di riferimento l'italia nord-occidentale ad un altitudine di 650 metri. nella risposta non ripetere la domanda."
            },
            {
                "role": "user",
                "content": domanda
            }
        ],
        temperature: 1,
        max_tokens: 80,
        top_p: 1,
    });

    console.log(response);
    res.send(response);
});

app.post("/api/prendiIrrigazioneAutomatica", async (req, res, next) => {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("azioni");
    let rq = collection.findOne({ "tipo": "gestioneAutomatico" });
    rq.then((data) => {
        res.send(data);
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});


app.post("/api/impostaArrayIstruzioniAutomatica", async (req, res, next) => {
    // let selected = req["body"].selected;
    // let humMin = req["body"].humMin;
    // let humMax = req["body"].humMax;
    mod = req["body"].mod;
    console.log("mod " + mod);
    // arrayIstruzioniAutomatica = [];
    // arrayIstruzioniAutomatica.push(selected);
    // arrayIstruzioniAutomatica.push(humMin);
    // arrayIstruzioniAutomatica.push(humMax);
    // console.log(arrayIstruzioniAutomatica);
    res.send("ok");
});

app.get("/api/meteoOggi", async (req, res, next) => {
    let rq = inviaRichiesta("GET", "https://api.open-meteo.com/v1/forecast?latitude=44.6833200&longitude=7.2757100&hourly=cloud_cover&hourly=precipitation&hourly=is_day&hourly=snowfall&hourly=temperature&timezone=Europe%2FBerlin")
    rq.then(function (response) {
        console.log(response.data); // Mostra i dati della risposta
        res.send(JSON.stringify(response.data));
    })
    rq.catch(function (err) {
        console.error(`Errore durante la richiesta GET:`);
        res.status(500).send(`Errore durante la richiesta GET:`);
    });
});

app.get("/api/getNews", async (req, res, next) => {
    let dataNews = req["query"].data;
    let rq = inviaRichiesta("GET", "https://newsapi.org/v2/everything?q=agricoltura&from=" + dataNews + "&language=it&sortBy=publishedAt&apiKey=636044f481dc4ce69645e7fe3020799c")
    rq.then(function (response) {
        console.log(response.data); // Mostra i dati della risposta
        res.send(JSON.stringify(response.data));
    })
    rq.catch(function (err) {
        console.error(`Errore durante la richiesta GET:`);
        res.status(500).send(`Errore durante la richiesta GET:`);
    });
});

app.get("/api/meteoSettimana", async (req, res, next) => {
    let rq = inviaRichiesta("GET", "https://api.open-meteo.com/v1/forecast?latitude=44.6833200&longitude=7.2757100&daily=temperature_2m_max&daily=temperature_2m_min&daily=precipitation_sum&daily=snowfall_sum&timezone=Europe%2FBerlin")
    rq.then(function (response) {
        console.log(response.data); // Mostra i dati della risposta
        res.send(JSON.stringify(response.data));
    })
    rq.catch(function (err) {
        console.error(`Errore durante la richiesta GET:`);
        res.status(500).send(`Errore durante la richiesta GET:`);
    });
});


function inviaRichiesta(method, url, parameters = {}) {
    let config = {
        "baseURL": "",
        "url": url,
        "method": method.toUpperCase(),
        "headers": {
            "Accept": "application/json",
        },
        "timeout": 15000,
        "responseType": "json",
    }

    console.log(config);

    if (parameters instanceof FormData) {
        config.headers["Content-Type"] = 'multipart/form-data;'
        config["data"] = parameters     // Accept FormData, File, Blob
    }
    else if (method.toUpperCase() == "GET") {
        config.headers["Content-Type"] = 'application/x-www-form-urlencoded;charset=utf-8'
        config["params"] = parameters
    }
    else {
        config.headers["Content-Type"] = 'application/json; charset=utf-8'
        config["data"] = parameters
    }
    return axios(config as any);
}

async function prendiIrrigazioneAutomatica(res: any, risposta: any) {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("azioni");
    let rq = collection.findOne({ "tipo": "gestioneAutomatico" });
    rq.then((data) => {
        risposta = { ...risposta, ...data };
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
}

app.post("/api/aggiornaIrrigazioneAutomatica", async (req, res, next) => {
    let humMax = req["body"].humMax;
    let humMin = req["body"].humMin;
    let selezionato = req["body"].selected;
    let posizione = req["body"].posizione;  //posizione dell'elemento selezionato
    console.log("selezzzz" + selezionato);
    console.log("posizione" + posizione);
    if (selezionato == true) {
        const client = new MongoClient(connectionString);
        await client.connect();
        let collection = client.db(DBNAME).collection("azioni");
        let rq = collection.updateMany({ "tipo": "gestioneAutomatico" }, { $set: { "disponibili.$[].selected": false } }); // Filtra l'array disponibili per trovare il secondo elemento non selezionato
        rq.then((data) => { console.log(data) });
        rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
        rq.finally(() => client.close());
    }
    if (posizione == undefined) {
        const client = new MongoClient(connectionString);
        await client.connect();
        let collection = client.db(DBNAME).collection("azioni");
        let rq = collection.updateOne({ "tipo": "gestioneAutomatico" }, { $set: { "disponibili.$[].selected": selezionato } }); // Filtra l'array disponibili per trovare il secondo elemento non selezionato
        rq.then((data) => {
            res.send(data);
        });
        rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
        rq.finally(() => client.close());
    }
    else {
        const client = new MongoClient(connectionString);
        await client.connect();
        let collection = client.db(DBNAME).collection("azioni");
        let rq = collection.updateOne({ "tipo": "gestioneAutomatico" }, { $set: { [`disponibili.${posizione}.selected`]: selezionato } }); // Filtra l'array disponibili per trovare il secondo elemento non selezionato
        rq.then((data) => {
            res.send(data);
        });
        rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
        rq.finally(() => client.close());
    }
});

app.post("/api/attivaDisattivaIrrigazione", async (req, res, next) => {
    statoIrrigazione = req["body"].stato;
    res.send("ok");

});

app.get("/api/chiedoStatoIrrigazione", async (req, res, next) => {
    res.send(statoIrrigazione);
});

app.post("/api/prendidati", async (req, res, next) => {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");
    let rq = collection.find({}).toArray();
    rq.then((data) => res.send(data));
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});



app.post("/api/prendiazioni", async (req, res, next) => {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("azioni");
    let rq = collection.find({}).toArray();
    rq.then((data) => res.send(data));
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});

app.post("/api/aggiornamodalita", async (req, res, next) => {
    let mod = req["body"].modalita;
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("azioni");
    let rq = collection.updateOne({ tipo: 'irrigazione' }, { $set: { 'modalita': mod } });
    rq.then((data) => res.send(data));
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});


app.post("/api/prendiStorico", async (req, res, next) => {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("storico");
    let rq = collection.find({}).toArray();
    rq.then((data) => res.send(data));
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});

app.post("/api/prendiAzioni", async (req, res, next) => {
    let tipo = req["body"].tipo;
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");
    let rq = collection.find({}).toArray();
    rq.then((data) => res.send(data));
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
});

app.post("/api/provaSocket", async (req, res, next) => {
    res.send("ok");
});

async function aggiungoUmidita(hum: any, ora: any, res: any, date: any) {
    //mi collego al db
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");

    //aggiungo il dato
    let rq = collection.updateOne({ tipo: 'umiditaAria' }, { $push: { 'valori': { "dato": hum, "ora": ora, "data": date } } });
    rq.then((data) => {
        console.log("aggiunta umidita");
    }
    );
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
}


async function aggiungoUmiditaTerra(hum: any, ora: any, res: any, date: any) {
    //mi collego al db
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");

    //aggiungo il dato
    let rq = collection.updateOne({ tipo: 'umiditaTerra' }, { $push: { 'valori': { "dato": hum, "ora": ora, "data": date } } });
    rq.then((data) => {
        console.log("aggiunta umidita");
    }
    );
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
}

async function aggiungoTemperatura(temp: any, ora: any, res: any, date: any) {
    //mi collego al db
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("dati");

    //aggiungo il dato
    let rq = collection.updateOne({ tipo: 'temperatura' }, { $push: { 'valori': { "dato": temp, "ora": ora, "data": date } } });
    rq.then((data) => {
        console.log("aggiunta temperatura");
    }
    );
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
}

async function eliminareDatiVecchi(data: import("mongodb").WithId<import("bson").Document>[], date: string, res: any, req: any) {
    for (let dato of data) {
        const client = new MongoClient(connectionString);
        await client.connect();
        let collection = client.db(DBNAME).collection("dati");
        let valori: never;
        //aggiungo il dato
        let rq = collection.updateMany({}, { $set: { valori: [] } })
        rq.then(async (data) => {
            console.log("cancellato");
        });
        rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
        rq.finally(() => client.close());
    }
}

async function aggiornaStorico(data: import("mongodb").WithId<import("bson").Document>[], date: string, res: any, req: any) {
    return new Promise(async (resolve, reject) => {

        for (let dato of data) {
            let valoriVecchi = [];
            let aggiungi = {};
            let campo = {};
            let contatore = 0;
            for (let valore of dato.valori) {

                aggiungi = { "ora": valore.ora, "dato": valore.dato };
                valoriVecchi.push(aggiungi);
                campo = { "tipo": dato.tipo, "data": valore.data, "valori": valoriVecchi };
                contatore++;

                if (contatore == dato.valori.length) {
                    console.log(dato.tipo);
                    console.log(contatore);

                    await aggiungoDatiStorico(campo, res, req, dato.tipo);

                }
            }
        }
        resolve("aggiunto");
    });
}

async function aggiungoDatiStorico(campo: any, res: any, req: any, tipo: any) {
    const client = new MongoClient(connectionString);
    await client.connect();
    let collection = client.db(DBNAME).collection("storico");
    //aggiungo il dato
    let rq = collection.insertOne(campo);
    rq.then(async (data) => {
        console.log("aggiunta: " + tipo);
    });
    rq.catch((err) => res.status(500).send(`Errore esecuzione query: ${err}`));
    rq.finally(() => client.close());
}
//********************************************************************************************//
// Default route e gestione degli errori
//********************************************************************************************//

app.use("/", (req, res, next) => {
    res.status(404);
    if (req.originalUrl.startsWith("/api/")) {
        res.send(`Api non disponibile`);
    }
    else {
        res.send(paginaErrore);
    }
});

app.use("/", (err, req, res, next) => {
    console.log("************* SERVER ERROR ***************\n", err.stack);
    res.status(500).send(err.message);
});






