
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const M3U_SOURCE = 'lista.m3u';

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function parseM3U(content) {
    const lines = content.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith('#EXTINF:')) {
            const nameMatch = line.match(/,(.*)$/);
            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            const groupMatch = line.match(/group-title="([^"]*)"/);

            currentChannel = {
                name: nameMatch ? nameMatch[1].trim() : 'Canal Sem Nome',
                logo: logoMatch && logoMatch[1]
                    ? logoMatch[1]
                    : 'https://via.placeholder.com/300x450.png?text=VOD',
                group: groupMatch && groupMatch[1]
                    ? groupMatch[1]
                    : 'Geral',
                url: ''
            };
        } else if (line && !line.startsWith('#') && currentChannel) {
            currentChannel.url = line;
            channels.push(currentChannel);
            currentChannel = null;
        }
    }

    return channels;
}

async function getM3UData(customUrl = null) {
    const source = customUrl || M3U_SOURCE;

    try {
        let content;

        if (/^https?:\/\//i.test(source)) {
            const response = await axios.get(source, {
                timeout: 60000,
                responseType: 'text',
                maxContentLength: 100 * 1024 * 1024
            });

            content = response.data;
        } else {
            const filePath = path.join(__dirname, source);

            if (!fs.existsSync(filePath)) {
                throw new Error('Arquivo M3U não encontrado.');
            }

            content = fs.readFileSync(filePath, 'utf-8');
        }

        return parseM3U(String(content));
    } catch (error) {
        console.error('Erro ao carregar M3U:', error.message);
        throw error;
    }
}

function getBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function validateDns(dns) {
    try {
        const url = new URL(dns);

        if (!['http:', 'https:'].includes(url.protocol)) {
            return false;
        }

        return Boolean(url.hostname);
    } catch (error) {
        return false;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        server: 'GRS Player MSX',
        version: '1.0.0'
    });
});

app.get('/api/catalog', async (req, res) => {
    const { dns, username, password } = req.query;

    let targetUrl = null;
    let expDate = 'Ilimitado';

    try {
        if (dns || username || password) {
            if (!dns || !username || !password) {
                return res.status(400).json({
                    error: 'Informe DNS, usuário e senha.'
                });
            }

            const cleanDns = String(dns).trim().replace(/\/+$/, '');
            const cleanUser = String(username).trim();
            const cleanPass = String(password).trim();

            if (!validateDns(cleanDns)) {
                return res.status(400).json({
                    error: 'Endereço DNS inválido.'
                });
            }

            targetUrl = `${cleanDns}/get.php?username=${encodeURIComponent(cleanUser)}&password=${encodeURIComponent(cleanPass)}&type=m3u_plus&output=ts`;

            try {
                const apiUrl = `${cleanDns}/player_api.php?username=${encodeURIComponent(cleanUser)}&password=${encodeURIComponent(cleanPass)}`;

                const apiCheck = await axios.get(apiUrl, {
                    timeout: 15000
                });

                if (apiCheck.data && apiCheck.data.user_info) {
                    const userInfo = apiCheck.data.user_info;

                    if (userInfo.exp_date) {
                        const timestamp = parseInt(userInfo.exp_date, 10);

                        if (timestamp > 0) {
                            expDate = new Date(timestamp * 1000)
                                .toLocaleDateString('pt-BR');
                        }
                    }
                }
            } catch (error) {
                console.error('Erro ao consultar vencimento:', error.message);
            }
        }

        const channels = await getM3UData(targetUrl);

        return res.json({
            expDate,
            items: channels
        });

    } catch (error) {
        console.error('Erro no catálogo:', error.message);

        return res.status(502).json({
            error: 'Não foi possível carregar a lista IPTV.',
            items: []
        });
    }
});

app.get('/msx/start.json', (req, res) => {
    const baseUrl = getBaseUrl(req);

    res.json({
        name: 'GRS Player MSX',
        version: '1.0.0',
        parameter: `content:${baseUrl}/msx/plugin.json`
    });
});

app.get('/msx/plugin.json', (req, res) => {
    const baseUrl = getBaseUrl(req);

    res.json({
        type: 'pages',
        headline: 'GRS Player',
        pages: [
            {
                items: [
                    {
                        type: 'space',
                        layout: '0,0,12,6',
                        action: `interaction:load:${baseUrl}/index.html`
                    }
                ]
            }
        ]
    });
});

app.get('/msx/group/:groupName.json', async (req, res) => {
    try {
        const groupName = req.params.groupName;

        const channels = await getM3UData();

        const filtered = channels.filter(channel =>
            channel.group.toLowerCase() === groupName.toLowerCase()
        );

        const items = filtered.map(channel => ({
            title: channel.name,
            label: channel.name,
            image: channel.logo,
            imageFiller: 'height-center',
            action: `video:${channel.url}`
        }));

        res.json({
            type: 'list',
            headline: groupName,
            template: {
                type: 'separate',
                layout: '0,0,2,3',
                icon: 'msx-white-soft:tv',
                color: 'msx-glass'
            },
            items
        });

    } catch (error) {
        res.status(500).json({
            error: 'Erro ao carregar grupo.',
            items: []
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor MSX rodando na porta ${PORT}`);
});
