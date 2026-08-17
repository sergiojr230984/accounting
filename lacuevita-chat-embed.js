(function () {
  const BACKEND_URL = 'https://lacuevita-chat-backend-production.up.railway.app/chat';

  const TRANSLATIONS = {
    en: {
      placeholder: 'Type your question...',
      send: 'Send',
      title: 'La Cuevita — Chat',
      toggle: 'ES',
      welcome: 'Hi! Welcome to La Cuevita Furniture. How can I help you today?',
      chips: ['Store hours', 'Delivery info', 'Current promotions', 'Contact us'],
    },
    es: {
      placeholder: 'Escribe tu pregunta...',
      send: 'Enviar',
      title: 'La Cuevita — Chat',
      toggle: 'EN',
      welcome: '¡Hola! Bienvenido a La Cuevita Furniture. ¿En qué te puedo ayudar?',
      chips: ['Horario', 'Información de entrega', 'Promociones', 'Contáctanos'],
    },
  };

  const SCRIPTED = {
    en: {
      'store hours': 'We are open Monday–Saturday 10am–7pm and Sunday 11am–5pm.',
      'delivery info': 'We offer local delivery within Miami-Dade and Broward. Contact us for a quote.',
      'current promotions': 'Visit our website or call us for the latest deals and promotions!',
      'contact us': 'Call us at (305) 555-0100 or email info@lacuevitafurniture.com.',
    },
    es: {
      'horario': 'Estamos abiertos de lunes a sábado de 10am a 7pm y domingos de 11am a 5pm.',
      'información de entrega': 'Ofrecemos entrega local en Miami-Dade y Broward. Contáctanos para un presupuesto.',
      'promociones': '¡Visita nuestra página web o llámanos para conocer las últimas ofertas!',
      'contáctanos': 'Llámanos al (305) 555-0100 o escríbenos a info@lacuevitafurniture.com.',
    },
  };

  let lang = 'en';
  let open = false;

  function detectLang(text) {
    const spanishWords = /\b(hola|gracias|cómo|dónde|cuándo|precio|entrega|horario|tienda|muebles|necesito|quiero|puede)\b/i;
    return spanishWords.test(text) ? 'es' : 'en';
  }

  function getScriptedReply(text) {
    const lower = text.toLowerCase().trim();
    const map = SCRIPTED[lang];
    for (const key in map) {
      if (lower.includes(key)) return map[key];
    }
    return null;
  }

  async function getReply(message) {
    const scripted = getScriptedReply(message);
    if (scripted) return scripted;
    try {
      const res = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, lang }),
      });
      if (!res.ok) throw new Error('Backend error');
      const data = await res.json();
      return data.reply || (lang === 'es' ? 'No entendí tu pregunta. ¿Puedes reformularla?' : "I didn't catch that. Could you rephrase?");
    } catch {
      return lang === 'es'
        ? 'Lo siento, no puedo responder en este momento. Llámanos al (305) 555-0100.'
        : 'Sorry, I cannot respond right now. Please call us at (305) 555-0100.';
    }
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #lcv-btn {
        position: fixed; bottom: 24px; right: 24px; z-index: 9999;
        width: 56px; height: 56px; border-radius: 50%;
        background: #6B3A2A; color: #fff; border: none; cursor: pointer;
        font-size: 26px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s;
      }
      #lcv-btn:hover { background: #4e2a1e; }
      #lcv-box {
        position: fixed; bottom: 90px; right: 24px; z-index: 9998;
        width: 340px; max-height: 520px;
        background: #fff; border-radius: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        display: flex; flex-direction: column; overflow: hidden;
        font-family: sans-serif; font-size: 14px;
        transition: opacity 0.2s, transform 0.2s;
      }
      #lcv-box.lcv-hidden { opacity: 0; pointer-events: none; transform: translateY(12px); }
      #lcv-header {
        background: #6B3A2A; color: #fff;
        padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;
        font-weight: bold; font-size: 15px;
      }
      #lcv-header-right { display: flex; gap: 8px; align-items: center; }
      #lcv-lang-toggle {
        background: rgba(255,255,255,0.2); border: none; color: #fff;
        border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; font-weight: bold;
      }
      #lcv-lang-toggle:hover { background: rgba(255,255,255,0.35); }
      #lcv-close {
        background: none; border: none; color: #fff;
        font-size: 20px; cursor: pointer; line-height: 1; padding: 0 4px;
      }
      #lcv-messages {
        flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
      }
      .lcv-msg {
        max-width: 80%; padding: 9px 13px; border-radius: 14px; line-height: 1.45; word-wrap: break-word;
      }
      .lcv-msg.user { background: #6B3A2A; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
      .lcv-msg.bot { background: #f1ece8; color: #333; align-self: flex-start; border-bottom-left-radius: 4px; }
      .lcv-msg.typing { color: #999; font-style: italic; }
      #lcv-chips { padding: 6px 12px; display: flex; flex-wrap: wrap; gap: 6px; }
      .lcv-chip {
        background: #f1ece8; border: 1px solid #d4b8a8; color: #6B3A2A;
        border-radius: 16px; padding: 5px 12px; font-size: 12px; cursor: pointer;
        white-space: nowrap;
      }
      .lcv-chip:hover { background: #e8ddd6; }
      #lcv-input-row {
        display: flex; padding: 10px 12px; gap: 8px; border-top: 1px solid #eee;
      }
      #lcv-input {
        flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 20px;
        outline: none; font-size: 14px;
      }
      #lcv-input:focus { border-color: #6B3A2A; }
      #lcv-send {
        background: #6B3A2A; color: #fff; border: none;
        border-radius: 20px; padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: bold;
      }
      #lcv-send:hover { background: #4e2a1e; }
    `;
    document.head.appendChild(style);
  }

  function buildWidget() {
    const t = TRANSLATIONS[lang];

    const btn = document.createElement('button');
    btn.id = 'lcv-btn';
    btn.innerHTML = '&#128172;';
    btn.title = 'Chat with us';

    const box = document.createElement('div');
    box.id = 'lcv-box';
    box.classList.add('lcv-hidden');

    box.innerHTML = `
      <div id="lcv-header">
        <span id="lcv-title">${t.title}</span>
        <div id="lcv-header-right">
          <button id="lcv-lang-toggle">${t.toggle}</button>
          <button id="lcv-close">&#x2715;</button>
        </div>
      </div>
      <div id="lcv-messages"></div>
      <div id="lcv-chips"></div>
      <div id="lcv-input-row">
        <input id="lcv-input" type="text" placeholder="${t.placeholder}" autocomplete="off" />
        <button id="lcv-send">${t.send}</button>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(box);

    addMessage('bot', t.welcome);
    renderChips();

    btn.addEventListener('click', () => {
      open = !open;
      box.classList.toggle('lcv-hidden', !open);
      if (open) document.getElementById('lcv-input').focus();
    });

    document.getElementById('lcv-close').addEventListener('click', () => {
      open = false;
      box.classList.add('lcv-hidden');
    });

    document.getElementById('lcv-lang-toggle').addEventListener('click', () => {
      lang = lang === 'en' ? 'es' : 'en';
      updateLang();
    });

    document.getElementById('lcv-send').addEventListener('click', handleSend);
    document.getElementById('lcv-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  function addMessage(role, text) {
    const msgs = document.getElementById('lcv-messages');
    const div = document.createElement('div');
    div.className = `lcv-msg ${role}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function renderChips() {
    const chips = document.getElementById('lcv-chips');
    chips.innerHTML = '';
    TRANSLATIONS[lang].chips.forEach((label) => {
      const btn = document.createElement('button');
      btn.className = 'lcv-chip';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        chips.innerHTML = '';
        handleMessage(label);
      });
      chips.appendChild(btn);
    });
  }

  function updateLang() {
    const t = TRANSLATIONS[lang];
    document.getElementById('lcv-title').textContent = t.title;
    document.getElementById('lcv-lang-toggle').textContent = t.toggle;
    document.getElementById('lcv-input').placeholder = t.placeholder;
    document.getElementById('lcv-send').textContent = t.send;
    renderChips();
  }

  async function handleSend() {
    const input = document.getElementById('lcv-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    document.getElementById('lcv-chips').innerHTML = '';
    handleMessage(text);
  }

  async function handleMessage(text) {
    lang = detectLang(text) || lang;
    updateLang();
    addMessage('user', text);
    const typing = addMessage('bot', '...');
    typing.classList.add('typing');
    const reply = await getReply(text);
    typing.classList.remove('typing');
    typing.textContent = reply;
    document.getElementById('lcv-messages').scrollTop = 9999;
  }

  injectStyles();
  buildWidget();
})();
