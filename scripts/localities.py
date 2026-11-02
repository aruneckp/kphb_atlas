"""Localities of Kukatpally (AC 46) used for the area view and the map.

Each entry: English name, Telugu/English spellings seen in the roll, and an
APPROXIMATE centre (lat, lng). Polling stations are placed near the centre of
the locality their name/address mentions. For exact pins run
`python3 scripts/geocode_stations.py` on a machine with internet, or drag a pin
in the Map page and save it.

Edit this list freely - more specific names should come first.
"""

LOCALITIES = [
    # KPHB and around
    ("Malaysian Township", ["మలేషియా", "malaysian"], (17.4858, 78.3880)),
    ("Vasanth Nagar", ["వసంత్ నగర్", "వసంత నగర్", "vasanth nagar"], (17.4985, 78.3872)),
    ("Kaithalapur", ["ఖైతలాపూర్", "కైతలాపూర్", "kaithalapur"], (17.4735, 78.3950)),
    ("Dharma Reddy Colony", ["ధర్మారెడ్డి", "ధర్మా రెడ్డి", "dharma reddy"], (17.4962, 78.3925)),
    ("KPHB Colony", ["కెపిహెచ్", "కే పి హెచ్", "కే పీ హెచ్", "కేపీహెచ్", "కె.పి.హెచ్", "కె పి హెచ్",
                     "పీహెచ్బి", "పిహెచ్బి", "హెచ్ బి కాలనీ", "కేపీహెబ్", "kphb", "k.p.h.b"], (17.4930, 78.3960)),
    # Kukatpally
    ("Balaji Nagar", ["బాలాజి నగర్", "బాలాజీ నగర్", "balaji nagar"], (17.4962, 78.4062)),
    ("Vivekananda Nagar", ["వివేకానంద", "వివేక్ నగర్", "వివేక్నగర్", "vivekananda", "vivek nagar"], (17.4880, 78.4088)),
    ("Gayatri Nagar", ["గాయత్రి నగర్", "gayatri nagar"], (17.4935, 78.4035)),
    ("Dayaraguda", ["దాయారుగుడా", "దయారుగూడ", "dayaraguda"], (17.4870, 78.4185)),
    ("Jinkalwada", ["జింకల్వాడ", "jinkalwada"], (17.4815, 78.4170)),
    ("Kukatpally", ["కూకట్పల్లి", "కూకట్ పల్లి", "కూకట్నల్లి", "కూకట్‌పల్లి", "కుకట్పల్లి", "కుకట్ పల్లి", "kukatpally"], (17.4849, 78.4138)),
    # Moosapet / Allapur / Moti Nagar / Bharat Nagar
    ("Rainbow Vistas", ["రైన్బో", "rainbow"], (17.4598, 78.4178)),
    ("Padmavathi Nagar", ["పద్మావతి నగర్", "padmavathi nagar"], (17.4688, 78.4322)),
    ("Rajiv Gandhi Nagar", ["రాజీవ్ గాంధి నగర్", "రాజీవ్ గాంధీ నగర్", "rajiv gandhi nagar"], (17.4645, 78.4302)),
    ("Parvath Nagar", ["పర్వత్ నగర్", "parvath nagar", "parvat nagar"], (17.4630, 78.4215)),
    ("Avanthi Nagar", ["అవంతి నగర్", "avanthi nagar"], (17.4612, 78.4318)),
    ("Allapur", ["అల్లాపూర్", "allapur"], (17.4705, 78.4285)),
    ("Moti Nagar", ["మోతీనగర్", "మోతి నగర్", "మోతీ నగర", "మోతీ నగర్", "moti nagar", "motinagar"], (17.4560, 78.4280)),
    ("Bharat Nagar", ["భరత్ నగర్", "భరత్‌నగర్", "భరత నగర", "bharat nagar"], (17.4600, 78.4335)),
    ("Moosapet", ["మూసాపేట", "మూసాపేట్", "moosapet"], (17.4656, 78.4252)),
    # Balanagar side
    ("Fatehnagar", ["ఫతేనగర్", "ఫతే నగర్", "fatehnagar", "fateh nagar"], (17.4590, 78.4430)),
    ("HAL Township", ["హెచ్ఏఎల్", "హెచ్.ఏ.ఎల్", "హెచ్ ఏ ఎల్", "హెచ్.ఎ.ఎల్", "హెచ్ఎఎల్", "hal township", "haltownship"], (17.4650, 78.4520)),
    ("Firozguda", ["ఫిరోజ్ గూడ", "ఫిరోజ్గూడ", "ఫెరోజ్", "firozguda", "ferozguda"], (17.4700, 78.4625)),
    ("Balanagar", ["బాలానగర్", "balanagar"], (17.4772, 78.4450)),
    ("Hasmathpet", ["హస్మత్", "hasmathpet"], (17.4772, 78.4712)),
    ("Old Bowenpally", ["బోవెన్పల్లి", "బోయిన్పల్లి", "బోయినపల్లి", "బౌయిన్", "బోయిన్ పల్లి", "బౌఎంపల్లి", "బౌయింపల్లి", "బోవెన్ పల్లి", "bowenpally"], (17.4722, 78.4762)),
    ("Prakash Nagar", ["ప్రకాష్ నగర్", "prakash nagar"], (17.4512, 78.4690)),
    ("Begumpet", ["బేగంపేట్", "బేగంపేట", "begumpet"], (17.4470, 78.4650)),
]

# Fallback centres by police station (Telugu as printed on the roll cover)
POLICE = {
    "కేపీహెబ్": ("KPHB", (17.4930, 78.3935)),
    "కూకట్ పల్లి": ("Kukatpally", (17.4849, 78.4138)),
    "క అల్లాపూర్": ("Allapur", (17.4705, 78.4285)),
    "అల్లాపూర్": ("Allapur", (17.4705, 78.4285)),
    "సనత్ నగర్": ("Sanath Nagar", (17.4590, 78.4400)),
    "ఓల్డ్ బోయిన్పల్లి": ("Old Bowenpally", (17.4722, 78.4762)),
    "బాలానగర్": ("Balanagar", (17.4772, 78.4450)),
    "ఆల్వాల్": ("Alwal", (17.4772, 78.4712)),
    "బేగంపేట్": ("Begumpet", (17.4470, 78.4650)),
}

# when a station's own name/address names no locality, it joins the main locality of its police station
POLICE_LOCALITY = {
    "KPHB": "KPHB Colony", "Kukatpally": "Kukatpally", "Allapur": "Allapur", "Balanagar": "Balanagar",
    "Old Bowenpally": "Old Bowenpally", "Alwal": "Hasmathpet", "Begumpet": "Begumpet", "Sanath Nagar": "Fatehnagar",
}

MANDALS = {"కూకట్ పల్లి": "Kukatpally", "బాలానగర్": "Balanagar"}

POST_OFFICES = {
    "జెఎన్టియు": "JNTU", "సనత్ నగర్": "Sanath Nagar", "ఓల్డ్ బౌయిన్సల్లి": "Old Bowenpally",
    "బాలానగర్": "Balanagar", "హస్మత్పేట": "Hasmathpet", "కూకట్పల్లి": "Kukatpally", "బేగంపేట్": "Begumpet",
}

CENTRE = (17.4760, 78.4280)  # middle of the constituency, used for the map's first view


def match(text):
    """First locality whose spelling appears in text, else None."""
    t = (text or "").lower()
    for name, pats, ll in LOCALITIES:
        for p in pats:
            if p.lower() in t:
                return name, ll
    return None
