const modules = require('./modules')

const defaults = {
	name: 'TuneIn',
	prefix: 'tunein_',
	host: 'https://api.tunein.com',
	icon: 'https://www.underconsideration.com/brandnew/archives/tunein_2017_logo_2.png',
	headers: { referer: 'https://tunein.com/', origin: 'https://tunein.com' },
	paginate: 100
}

let sessionID

var url = {
    catalog: function(page) {
        return defaults.host + '/categories/trending?formats=mp3,aac,ogg,flash,html&serial='+sessionID+'&partnerId=RadioTime&version=2.43&itemUrlScheme=secure&build=2.43.0&reqAttempt=1'
    },
    search: function(query, start, limit) {
        return defaults.host + '/profiles?fullTextSearch=true&query=' + encodeURIComponent(query) + '&formats=mp3,aac,ogg,flash,html&serial='+sessionID+'&partnerId=RadioTime&version=2.43&itemUrlScheme=secure&build=2.43.0&reqAttempt=1'
    },
    stream: function(channelId, token) {
        return 'https://opml.radiotime.com/Tune.ashx?id='+channelId+'&render=json&itemToken='+token+'&formats=mp3,aac,ogg,flash,html&type=station&serial='+sessionID+'&partnerId=RadioTime&version=2.43&itemUrlScheme=secure&build=2.43.0&reqAttempt=1'
    },
    meta: function(channelId, token) {
        return defaults.host + '/profiles/'+channelId+'/contents?itemToken='+token+'&formats=mp3,aac,ogg,flash,html&serial='+sessionID+'&partnerId=RadioTime&version=2.43&itemUrlScheme=secure&build=2.43.0&reqAttempt=1'
    }
}

function tuneinMetaObj(el, url) {
    return {
        backgroundShape: 'contain',
        id: defaults.prefix + el.id,
        name: modules.get.ent.decode(el.title || ' '),
        poster: el.thumb || '',
        logo: el.thumb || '',
        posterShape: 'square',
        background: el.thumb || '',
        genre: [ 'Radio' ],
        isFree: 1,
        popularity: 1,
        type: 'tv'
    }
}

function normalizeResults(res) {
    return res.map(function(el) {

        if (el && el.Children && el.Children[0])
            el = el.Children[0]

        return {
            id: el.GuideId +'---'+ el.Context.Token,
            title: el.Title || '',
            thumb: el.Image || '',
            tags: []
        }
    })
}

function phantomLoad(opts, cb) {
	var phInstance

	modules.get.phantom.create(["--ignore-ssl-errors=true", "--web-security=false", "--ssl-protocol=tlsv1", "--load-images=false", "--disk-cache=true"], { logLevel: 'warn' })
//		phantom.create(["--ignore-ssl-errors=true", "--web-security=false", "--ssl-protocol=tlsv1"], { logLevel: opts.log || 'warn' })

	.then(function(instance) {
		phInstance = instance
		return instance.createPage()
	})
	.then(function(page) {

// this breaks phantomjs responses for some reason:

//			if (!opts.timeout)
//				opts.timeout = 15000 // default timeout of 15 secs

//			page.property('settings', { resourceTimeout: opts.timeout })

		if (opts.clearMemory)
			page.invokeMethod('clearMemoryCache')

		if (opts.referer)
			page.property('customHeaders', { 'Referer': opts.referer })

		if (opts.agent)
			page.setting('userAgent', opts.agent)

		if (opts.noRedirect)
			page.property('navigationLocked', true)

//			page.on('onResourceTimeout', function() {
//				log('Page Timed Out')
//			})

		cb(phInstance, page)

	})
}

function phantomClose(instance, page, cb) {

	setTimeout(function() {

		var end = function() {
			var next = cb = function() {}
			instance.exit().then(cb || next, cb || next)
		}

		page.close().then(end, end)

	})

}

let sessionQueue

function setNamedQueue() {
	if (!sessionQueue) {
		sessionQueue = new modules.get['named-queue']((task, cb) => {
			getSessionId(gotSessionId, cb)
		}, 1)
	}
	return true
}

function getSessionId(cb, endCb) {
	if (sessionID) {
		endCb(true)
		return
	}
    phantomLoad({
        clearMemory: true,
        agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36',
    }, function(phInstance, page) {

        let tuneInSessionId

		page.on('onResourceRequested', function(req, netReq) {
			if (!tuneInSessionId && req.url.includes('https://opml.radiotime.com/')) {
				var matches = req.url.match(/&serial=[a-z0-9-]+/gm)
				if (matches.length) {
					tuneInSessionId = matches[0].split('=')[1]
					console.log(tuneInSessionId)
				}
			}
		})

        page.open('https://www.tunein.com/').then(async (status, body) => {
            cb(tuneInSessionId, endCb)
            phantomClose(phInstance, page, () => {})
        }, function(err) {
        	console.log(err)
            cb(false, endCb)
            phantomClose(phInstance, page, () => {})
        })
    })

}

let retries = 15

function gotSessionId(sessionId, endCb) {
    if (!sessionId) {
        if (retries) {
            retries--
            console.log(defaults.name + ' - Retrying to get session ID')
            setTimeout(() => {
                getSessionId(gotSessionId, endCb)
            }, 1500)
            return
        }
        console.error(defaults.name + ' - Could not get TuneIn Session ID')
        endCb(false)
        return
    }
    sessionID = sessionId
    endCb(true)
}

module.exports = {
	manifest: local => {
		modules.set(local.modules)
		setNamedQueue()
		sessionQueue.push({ id: 'session' }, () => {})
		return Promise.resolve({
			id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
			version: '1.0.0',
			name: defaults.name,
			description: 'Radios from TuneIn',
			resources: ['stream', 'meta', 'catalog'],
			types: ['tv'],
			idPrefixes: [defaults.prefix],
			icon: defaults.icon,
			catalogs: [
				{
					id: defaults.prefix + 'cat',
					name: 'TuneIn',
					type: 'tv',
					extra: [{ name: 'search' }, { name: 'skip' }]
				}
			]
		})
	},
	handler: (args, local) => {
		modules.set(local.modules)
		setNamedQueue()
		return new Promise((resolve, reject) => {

			sessionQueue.push({ id: 'session' }, success => {
				if (!success)
					reject(defaults.name + ' - Could not extract API token to handle request')
				else {
					const persist = local.persist
					const config = local.config
					const proxy = modules.get.internal.proxy
					const extra = args.extra || {}
					const skip = parseInt(extra.skip || 0)

				    if (!args.id) {
				        reject(new Error(defaults.name + ' - No ID Specified'))
				        return
				    }

					if (args.resource == 'catalog') {
				        if (extra.search) {
				        	const reqUrl = url.search(extra.search, 0, 75)
					        modules.get.needle.get(reqUrl, { headers: { referer: reqUrl, origin: defaults.host } }, function(err, resp, res) {
					            if (res && res.Items && res.Items.length)
					                resolve({ metas: normalizeResults(res.Items).map(function(el) { return tuneinMetaObj(el) }) })
					            else reject(defaults.name + ' - No Response Body 2')
					        })
				        } else {
				        	const reqUrl = url.catalog()
				            modules.get.needle.get(reqUrl, { headers: { referer: reqUrl, origin: defaults.host } }, function(err, resp, res) {
				                if (res && res.Items && res.Items[0] && res.Items[0].Children && res.Items[0].Children.length)
				                   	resolve({ metas: normalizeResults(res.Items[0].Children).map(function(el) { return tuneinMetaObj(el) }).slice(skip, skip + defaults.paginate) })
				                else reject(defaults.name + ' - No Response Body 1')
				            })
				        }
					} else if (args.resource == 'meta') {
				        args.id = args.id.replace(defaults.prefix, '')
				        var parts = args.id.split('---')
				        const reqUrl = url.meta(parts[0], parts[1])
				        modules.get.needle.get(reqUrl, { headers: { referer: reqUrl, origin: defaults.host } }, function(err, r, resp) {
				           if (resp && resp.Items && resp.Items.length) {
				            var item
				            resp.Items.some(function(el) {
				                if (el && el.Title == 'Stations') {
				                    if (el.Children && el.Children[0]) {
				                        item = el.Children[0]
				                    }
				                }
				            }) 
				            if (item) {
				                var parsedMeta = tuneinMetaObj(normalizeResults([item])[0])
				                parsedMeta.id = defaults.prefix + args.id
				                resolve({ meta: parsedMeta })
				            } else
				                reject(defaults.name + ' - No Meta Found 2')
				          } else reject(defaults.name + ' - No Meta Found 1')
				        })
					} else if (args.resource == 'stream') {
						const parts = args.id.replace(defaults.prefix, '').split('---')
						const reqUrl = url.stream(parts[0], parts[1])
				        modules.get.needle.get(reqUrl, { headers: { referer: reqUrl, origin: defaults.host } }, function(err, r, resp) {
				            if (((resp || {}).body || []).length) {
				            	const streams = []
				            	const q = modules.get.async.queue((task, cb) => {
				            		if (task.url.startsWith('https://stream.radiotime.com/'))
					            		modules.get.needle.get(task.url, { headers: defaults.headers, read_timeout: 5000 }, (err, resp, body) => {
					            			if (!err && ((body || {})['Streams'] || []).length) {
					            				body['Streams'].forEach(el => {
					            					streams.push({
					            						url: el.Url,
					            						title: el.Bandwidth ? ('Bitrate: '+el.Bandwidth) : '',
					            						tag: [(el.MediaType || 'mp3')]
					            					})
					            				})
					            			}
				            				streams.push(task)
					            			cb()
					            		})
					            	else {
			            				streams.push(task)
				            			cb()
					            	}
				            	})
				            	q.drain = () => {
				            		if (streams.length)
				            			resolve({ streams })
				            		else reject(defaults.name + ' - No Streams Found 2')
				            	}
				                resp.body.forEach(function(el) {
				                    q.push({
				                      url: el.url,
				                      title: el.bitrate ? ('Bitrate: '+el.bitrate) : '',
				                      tag: [(el.media_type || 'mp3')]
				                    })
				                })
				            } else reject(defaults.name + ' - No Streams Found 1')
				        })
					}
				}
			})
		})
	}
}
