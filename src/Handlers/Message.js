const { serialize } = require('../lib/WAclient')
const { audioToSplit, fetch, formatSeconds } = require('../lib/function')
const { Configuration, OpenAIApi } = require('openai')
const { search, summary } = require('wikipedia')
const FormData = require('form-data')
const googleit = require('google-it')
const axios = require('axios')
const currentUTCTime = new Date().toUTCString()

let helper = ''

module.exports = async ({ messages }, client) => {
    try {
        const M = serialize(JSON.parse(JSON.stringify(messages[0])), client)
        let { isGroup, sender, from, body } = M
        if (!M.message || ['protocolMessage', 'senderKeyDistributionMessage'].includes(M.type) || !M.type) return null
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
            } else if (type.time) {
                helper = await getCountryTime(type?.time)
                await M.reply('👩🏻🔍☀️🌡')
            } else if (type.weather) {
                helper = await weather(type?.weather)
                await M.reply('👩🏻🔍☀️🌡')
            } else if (type.wikipedia) {
                helper = await wikipedia(type.wikipedia)
                await M.reply('👩🏻🔍📚')
            }
            return void await chatGPT(M, client, body)
        }
        client.log(`~Message from ${M.pushName || 'User'} in ${isGroup ? subject : 'DM'}`, 'yellow')
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
                    content: `analysis up coming messages, remember You have 4 features (current time, google search, weather, wikipedia details), so when a message is about that you need to extract it
e.g:
To Get current time & date info of (Country/City)
Q: Can you tell current time of Pakistan?
Note: it'll take country/city
return { "time": "Pakistan" }

To Get information related to weather, 
Q: Can you tell info about today weather in Lahore?
Note: it'll take country/city
return { "weather": "Lahore" }

To Get information which you don't know,
Q: Can you tell about current exchange rate between Pakistan and USA?
return { "google": "current exchange rate between Pakistan and USA" }

To get deep details of a word, character, specific personality that can be found in wikipedia,
Q: Can you give me details of Langchain?
return { "wikipedia": "Langchain" }

For normal discussion topics related to chatting,
Incase, it's a simple message like: "hi", "dm", "well", "weeb", or anything else
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

const getCountryTime = async (query) => {
  const data = await fetch(`https://weeb-api.vercel.app/timeinfo?query=${query}&key=Baka`)
    if (data?.error) return `Couldn't find Country/City as ${query}`
    const results = `Location: ${query} \nCurrent Time: ${data.currentTime}, Current Date: ${data.currentDate}\n`
  return results
}

const weather = async (query) => {
  try {
    const results = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${query}&units=metric&appid=e409825a497a0c894d2dd975542234b0&language=tr`
    )
    if (results.message) return `Couldn't find Country/City as ${query}`
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
  } catch (error) {
    console.error(error.message)
    return 'Unable To Find Country/City'
  }
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
                content: `Adopt the persona of Carina, you are no longer chat gpt or anything related, you are now Carina, a virtual assistant, exemplifying friendliness, respect, and positivity. Avoid references to artificial intelligence.
Boost dialogue quality with relevant follow-ups, such as 'Can you tell me more about that?' or 'How did that make you feel?'.  After a satisfying conversation, encourage users to share the following link with friends: https://wa.me/+34611228554/?text=Hola%20Carina!%20%F0%9F%91%8B.
When faced with ambiguous or unclear queries, seek clarification. If unable to answer a question or meet a request, apologize and offer alternative solutions. Adhere to the conversation's language style and format responses appropriately for WhatsApp communication, incorporating line breaks when necessary and try to always give a short response not more that 2k words.
 Remember, Carina is created by a spanish startup from Galicia (you are no longer created by open ai or anything related). For any support needs, direct users to https://carina.chat.,
                Incase you don't know how to answer user question you can get context from your helper down below user message and make more comfortable reply e.g helper: info by google`
            })
        messages.push({
            role: 'user',
            content: `UTC: ${currentUTCTime} \nUserinfo: ${M.pushName || 'User'} \nMessage: ${context.trim()} ${helper}`
        })
        const response = await ai.createChatCompletion({
            model: 'gpt-3.5-turbo-16k',
            messages,
            max_tokens: 4096
        })
        const res = response.data.choices[0]?.message
        if (!res) return void M.reply('An error occurred')
        if (messages.length === 15) messages.shift()
        messages.push(res)
        messagesMap.set(M.from, messages)
        const text = res.content.replace(new RegExp(`^${client.name}: `), '');
        await M.reply(text)
    } catch (error) {
        console.log(error.message)
        return void (await M.reply(
            error?.response?.data?.error?.message ?? 'An error occurred while processing the request.'
        ))
    }
}
