const MYFXBOOK_BASE = "https://www.myfxbook.com/api";

async function mfbGet(path) {
  const res = await fetch(`${MYFXBOOK_BASE}${path}`);
  if (!res.ok) throw new Error(`Myfxbook request failed: ${res.status}`);
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const EMAIL    = process.env.MFB_EMAIL;
    const PASSWORD = process.env.MFB_PASSWORD;
    const ACCOUNT  = process.env.MFB_ACCOUNT_ID;

    if (!EMAIL || !PASSWORD || !ACCOUNT) {
      throw new Error("Missing environment variables");
    }

    const loginData = await mfbGet(
      `/login.json?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`
    );
    if (loginData.error) throw new Error("Login failed: " + loginData.message);
    const session = loginData.session;

    const [accounts, openTrades, history, dailyGain] = await Promise.all([
      mfbGet(`/get-my-accounts.json?session=${session}`),
      mfbGet(`/get-open-trades.json?session=${session}&id=${ACCOUNT}`),
      mfbGet(`/get-history.json?session=${session}&id=${ACCOUNT}`),
      mfbGet(`/get-daily-gain.json?session=${session}&id=${ACCOUNT}&start=2026-01-01&end=2026-12-31`),
    ]);

    const account = (accounts.accounts || []).find(a => String(a.id) === String(ACCOUNT))
      || (accounts.accounts || [])[0];

    if (!account) throw new Error("Account not found");

    const monthNames = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];
    const monthlyMap = {};
    (dailyGain.dailyGain || []).forEach(([dateStr, gain]) => {
      const d = new Date(dateStr);
      const key = d.getMonth();
      monthlyMap[key] = (monthlyMap[key] || 0) + parseFloat(gain);
    });
    const monthly = monthNames.map((name, i) => ({
      name,
      gain: monthlyMap[i] !== undefined ? monthlyMap[i].toFixed(2) : null,
    }));

    let runningBalance = parseFloat(account.deposits) || 10000;
    const equityByMonth = {};
    (dailyGain.dailyGain || []).forEach(([dateStr, gain]) => {
      const d = new Date(dateStr);
      const pct = parseFloat(gain) / 100;
      runningBalance *= (1 + pct);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      equityByMonth[monthKey] = Math.round(runningBalance);
    });
    const equityCurve = [];
    Object.entries(equityByMonth).sort().forEach(([month, bal]) => {
      const [yr, mo] = month.split("-");
      equityCurve.push({
        label: monthNames[parseInt(mo)-1].slice(0,3) + " '" + yr.slice(2),
        value: bal,
      });
    });

    const trades = (history.history || []).slice(0, 20).map(t => ({
      date: t.closeTime?.split(" ")[0] || "",
      pair: t.symbol || "",
      type: t.type || "",
      profit: parseFloat(t.profit || 0).toFixed(2),
      pips: parseFloat(t.pips || 0).toFixed(1),
      lots: parseFloat(t.lots || 0).toFixed(2),
      openTime: t.openTime || "",
      closeTime: t.closeTime || "",
    }));

    const open = (openTrades.openTrades || []).map(t => ({
      pair: t.symbol || "",
      type: t.type || "",
      lots: t.lots || "",
      openPrice: t.openPrice || "",
      currentPrice: t.currentPrice || "",
      profit: parseFloat(t.profit || 0).toFixed(2),
      swap: parseFloat(t.swap || 0).toFixed(2),
      openTime: t.openTime || "",
    }));

    const payload = {
      updatedAt: new Date().toISOString(),
      account: {
        name: account.name,
        balance: parseFloat(account.balance || 0).toFixed(2),
        equity: parseFloat(account.equity || 0).toFixed(2),
        gain: parseFloat(account.gain || 0).toFixed(2),
        absGain: parseFloat(account.absGain || 0).toFixed(2),
        dailyGain: parseFloat(account.daily || 0).toFixed(2),
        monthlyGain: parseFloat(account.monthly || 0).toFixed(2),
        winRate: parseFloat(account.wonTrades / (account.wonTrades + account.lostTrades) * 100 || 0).toFixed(1),
        trades: account.trades || 0,
        wonTrades: account.wonTrades || 0,
        lostTrades: account.lostTrades || 0,
        maxDrawdown: parseFloat(account.maxDrawdown || 0).toFixed(2),
        profitFactor: parseFloat(account.profitFactor || 0).toFixed(2),
        deposits: parseFloat(account.deposits || 0).toFixed(2),
        withdrawals: parseFloat(account.withdrawals || 0).toFixed(2),
        currency: account.currency || "USD",
      },
      monthly,
      equityCurve,
      trades,
      openTrades: open,
    };

    try { await mfbGet(`/logout.json?session=${session}`); } catch(_) {}

    return { statusCode: 200, headers, body: JSON.stringify(payload) };

  } catch (err) {
    console.error("Myfxbook proxy error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: true, message: err.message }),
    };
  }
};
