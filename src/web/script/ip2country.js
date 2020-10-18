/*
Usage: ip2country_CountryToEmoji("TW")
-> 🇹🇼
*** MUST SAVE AS UTF8***
*** RegionCode might not showing correctly if your computer are missing those fonts ***
*** DO NOT ALTER RegionCode ***
*/
function ip2country_CountryToEmoji(ISO3166) {
    if (ISO3166.length !== 2) {
        return ""
    }
    var RegionCode = JSON.parse('{"A":"🇦","B":"🇧","C":"🇨","D":"🇩","E":"🇪","F":"🇫","G":"🇬","H":"🇭","I":"🇮","J":"🇯","K":"🇰","L":"🇱","M":"🇲","N":"🇳","O":"🇴","P":"🇵","Q":"🇶","R":"🇷","S":"🇸","T":"🇹","U":"🇺","V":"🇻","W":"🇼","X":"🇽","Y":"🇾","Z":"🇿"}')
    ISO3166Arr = ISO3166.split("");
    return RegionCode[ISO3166Arr[0]] + RegionCode[ISO3166Arr[1]]
}