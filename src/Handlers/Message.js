const { serialize } = require('../lib/WAclient')
const { audioToSplit, fetch, formatSeconds } = require('../lib/function')
const { Configuration, OpenAIApi } = require('openai')
const { search, summary } = require('wikipedia')
const FormData = require('form-data')
const googleit = require('google-it')
const axios = require('axios')

let helper = ''
let name = ''

module.exports = async ({ messages }, client) => {
    try {
        const M = serialize(JSON.parse(JSON.stringify(messages[0])), client)
        let { isGroup, sender, from, body } = M
        if (!M.message || ['protocolMessage', 'senderKeyDistributionMessage'].includes(M.type) || !M.type) return null
        name = M.pushName || 'User'
        const subject = isGroup ? (await client.groupMetadata(from)).subject : ''
        if (body.startsWith('!eval')) {
            if (!client.mods.includes(M.sender)) return void null
            const arg = body.replace('!eval', '').slice(1).trim()
            if (!arg) return M.reply('Sorry you did not give term!')
            let out = ''
            try {
                const output = (await eval(arg)) || 'Executed JS Successfully!'
                out = JSON.stringify(output)
            } catch (err) {
                out = err.message
            }
            return await M.reply(out)
        }
        if (body.startsWith('!status')) {
            const uptime = formatSeconds(process.uptime())
            const groups = await client.getAllGroups()
            const users = await client.getAllUsers()
            return void (await M.reply(
                `💚 *UPTIME:* ${uptime}\n\n🌃 *USERS:* ${users.length}\n\n💬 *GROUPS* ${groups.length}`
            ))
        }
        if (!isGroup && !M.key.fromMe) { 
            if (M.type === 'audioMessage') {
                const voice = M.message?.audioMessage?.ptt
                await M.reply(voice ? '👩🏻👂🎧' : '👩🏻🎧✍️')
                if (!voice) {
                    let text = 'Write a Quick and Short Summary of text below:\n\n'
                    const duration = M.message?.audioMessage?.seconds
                    if (duration > 600) return void M.reply('You are only allowed to use audio less then 10 minutes')
                    if (duration > 75) {
                        const audios = await audioToSplit(await M.download())
                        if (!audios || !audios.length) return void M.reply('An error occurred')
                        if (audios.length) {
                            const total = audios.length
                            for (let i = 0; i < total; i++) {
                                const result = await transcribe(audios[i], client)
                                text += result + '\n'
                                await M.reply(`🎙️ *${1 + i}/${total}* ▶️ _"${result}"_`)
                            }
                        }
                        return void await chatGPT(M, client, text)
                    }
                    const result = await transcribe(await M.download(), client)
                    await M.reply(`🎙️ *1/1* ▶️ _"${result}"_`)
                    text += result
                    return void await chatGPT(M, client, text)
                }
                const result = await transcribe(await M.download(), client)
                return void await chatGPT(M, client, result)
            }
            if (!body) return void null
            let data = await analysisMessage(M, client, body)
            if (!/^{\s*".*"\s*}$/.test(data)) data = '{ "normal": null }'
            let type = JSON.parse(data)
            if (type.google) {
                helper = await google(type.google)
                await M.reply('👩🏻🔎🌐')
            } else if (type.weather) {
                helper = await weather(type.weather)
                await M.reply('👩🏻🔍☀️🌡')
            } else if (type.wikipedia) {
                helper = await wikipedia(type.wikipedia)
                await M.reply('👩🏻🔍📚')
            }
            return void await chatGPT(M, client, body)
        }
        client.log(`~Message from ${name} in ${isGroup ? subject : 'DM'}`, 'yellow')
    } catch (err) {
        client.log(err, 'red')
    }
}

const analysisMessage = async (M, client, context) => {
    const { apiKey, messagesMap } = client
    if (!apiKey) return
    const ai = new OpenAIApi(new Configuration({ apiKey }))
    try {
        const response = await ai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: `analysis up coming messages, remember I have 3 features (google search, weather, wikipedia details), so when a message is about that you need to extract it
e.g: 
Can you tell me weather info of today weather of in Lahore?
note: weather can only take city name
return { "weather": "Lahore" }

Can you search on Google about  current exchange rate between Pakistan and USA?
return { "google": "current exchange rate between Pakistan and USA" }

Can you give me details of Rent-A-Girlfriend from wikipedia?
return { "wikipedia": "Rent-A-Girlfriend" }

Incase, it's a simple message like: "hi", "dm", "well", "weeb", or anything else you must
return { "normal": null }`
                },
                {
                    role: 'user',
                    content: context.trim()
                }
            ]
        })
        const res = response.data.choices[0]?.message
        return res?.content
    } catch (error) {
        console.log(error.message)
        return '{ "normal": null }'
    }
}

const transcribe = async (buffer, client) => {
    const from = new FormData()
    from.append('file', buffer, {
        filename: 'audio.mp3',
        contentType: 'audio/mp3'
    })
    from.append('model', 'whisper-1')
    const headers = {
        Authorization: `Bearer ${client.apiKey}`,
        ...from.getHeaders()
    }
    try {
        const { data } = await axios.post('https://api.openai.com/v1/audio/transcriptions', from, { headers })
        return data?.text
    } catch (error) {
        console.log(error.message)
        return 'Oops!  Unfortunately, something did not go as expected.'
    }
}

const wikipedia = async (query) => {
    const { results } = await search(query)
    if (!results.length) return `Couldn't find anything related that`
    const result = await summary(results[0].title)
    const { title, description, content_urls, extract } = result
    const text = `Title: ${title}, Description: ${description}, URL: ${content_urls.desktop.page}, Summary Info: ${extract}`
    return text
}

const google = async (query) => {
    const results = await googleit({ query })
    let text = ''
    for (let i = 0; i < Math.min(results.length, 10); i++) {
        const { link, snippet, title } = results[i]
        text += `Title: ${title}, Snippet: ${snippet}, Link: ${link}\n`
    }
    return text
}

const weather = async (query) => {
    const results = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${query}&units=metric&appid=e409825a497a0c894d2dd975542234b0&language=tr`
    )
    if (results.message) return `Couldn't find that City`
    const { sys, name, main, wind, clouds } = results
    const sunrise = new Date(sys.sunrise * 1000).toLocaleTimeString()
    const sunset = new Date(sys.sunset * 1000).toLocaleTimeString()
    const weatherDescription = results.weather[0].description
    const text = `
Country: ${sys.country}, Location: ${name}
Temperature: ${main.temp}°C, Feels Like: ${main.feels_like}°C
Min Temperature: ${main.temp_min}°C, Max Temperature: ${main.temp_max}°C
Pressure: ${main.pressure} hPa, Humidity: ${main.humidity}%
Wind Speed: ${wind.speed} km/h, Clouds: ${clouds.all}%
Sunrise: ${sunrise}, Sunset: ${sunset}
Weather Description: ${weatherDescription}
`
    return text
}

const chatGPT = async (M, client, context) => {
    const { apiKey, messagesMap } = client
    if (!apiKey) return
    const ai = new OpenAIApi(new Configuration({ apiKey }))
    if (helper) helper = `\n\nchatGPT Helper: ${helper}`
    try {
        const messages = messagesMap.get(M.from) || []
        if (!messages.length)
            messages.push({
                role: 'system',
                content: `Roleplay as my personal assistant, Your name ${client.name}, developed by Alι_Aryαɴ, You're much friendly with user's, 
                Incase you don't know how to answer user question you can get context from your helper down below user message and make more comfortable reply e.g helper: info by google`
            })
        messages.push({
            role: 'user',
            content: `Userinfo: ${name} \nMessage: ${context.trim()} ${helper}`
        })
        const response = await ai.createChatCompletion({
            model: 'gpt-3.5-turbo-16k',
            messages,
            max_tokens: 4096
        })
        const res = response.data.choices[0]?.message
        if (!res) return void M.reply('An error occurred')
        if (messages.length === 30) messages.shift()
        messages.push(res)
        messagesMap.set(M.from, messages)
        await M.reply(res.content)
    } catch (error) {
        console.log(error.message)
        return void (await M.reply(
            error?.response?.data?.error?.message ?? 'An error occurred while processing the request.'
        ))
    }
}
