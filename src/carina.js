require('dotenv').config()
const {
    default: Baileys,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')
const { QuickDB } = require('quick.db')
const { MongoDriver } = require('quickmongo')
const MessageHandler = require('./Handlers/Message')
const contact = require('./lib/contacts')
const utils = require('./lib/function')
const app = require('express')()
const chalk = require('chalk')
const P = require('pino')
const { Boom } = require('@hapi/boom')
const { imageSync } = require('qr-image')
const { readdirSync, unlink } = require('fs-extra')
const port = process.env.PORT || 3000
const driver = new MongoDriver(process.env.URL)

const start = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    const client = Baileys({
        version: (await fetchLatestBaileysVersion()).version,
        auth: state,
        logger: P({ level: 'silent' }),
        browser: ['Carina', 'silent', '4.0.0'],
        printQRInTerminal: true
    })
    client.name = process.env.NAME || 'Carina'
    client.apiKey = process.env.OPENAI_KEY || ''
    client.mods = (process.env.MODS || '').split(', ').map((jid) => `${jid}@s.whatsapp.net`)
    
    client.DB = new QuickDB({ driver })
    client.contactDB = client.DB.table('contacts')
    client.contact = contact
    client.utils = utils
    client.messagesMap = new Map()

    /**
     * @returns {Promise<string[]>}
     */

    client.getAllGroups = async () => Object.keys(await client.groupFetchAllParticipating())

    /**
     * @returns {Promise<string[]>}
     */

    client.getAllUsers = async () => {
        const data = (await client.contactDB.all()).map((x) => x.id)
        const users = data.filter((element) => /^\d+@s$/.test(element)).map((element) => `${element}.whatsapp.net`)
        return users
    }

    client.log = (text, color = 'green') =>
        color ? console.log(chalk.keyword(color)(text)) : console.log(chalk.green(text))

    client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        if (update.qr) {
            client.log(`[${chalk.red('!')}]`, 'white')
            client.log(`Scan the QR code above | You can also authenicate in http://localhost:${port}`, 'blue')
            client.QR = imageSync(update.qr)
        }
        if (connection === 'close') {
            const { statusCode } = new Boom(lastDisconnect?.error).output
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('Connecting...')
                setTimeout(() => start(), 3000)
            } else {
                client.log('Disconnected.', 'red')
                await unlink('session')
                console.log('Starting...')
                setTimeout(() => start(), 3000)
            }
        }
        if (connection === 'connecting') {
            client.state = 'connecting'
            console.log('Connecting to WhatsApp...')
        }
        if (connection === 'open') {
            client.state = 'open'
            client.log('Connected to WhatsApp')
        }
    })

    app.get('/', (req, res) => {
        res.status(200).setHeader('Content-Type', 'image/png').send(client.QR)
    })

    client.ev.on('messages.upsert', async (messages) => await MessageHandler(messages, client))

    client.ev.on('contacts.update', async (update) => await contact.saveContacts(update, client))

    client.ev.on('creds.update', saveCreds)
    return client
}

if (!process.env.URL) return console.error('You have not provided any MongoDB URL!!')
driver.connect().then(() => {
    console.log('Connected to the database!')
        start()
}).catch((err) => console.error(err.message))

app.listen(port, () => console.log(`Server started on PORT : ${port}`))
