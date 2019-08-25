<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<html>
   <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="../../../script/tocas/tocas.css">
      <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
      <script src="../../../script/jquery.min.js"></script>
      <title>Timezone</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	  <style>
	  </style>
   </head>


<body>
<div class="ts container">
<br>
<h2 class="ts header">Timezone</h2>
<div class="ts segmented items">
	<div class="item">
<div class="ts labeled input">
    <div class="ts label">
        Select region&nbsp;:&nbsp; 
    </div>
   <select onclick="change(this)" id="SelectRegion" class="ts basic dropdown">
<option>---Select---</option>
<option value="AD">Andorra</option>
<option value="AE">United Arab Emirates</option>
<option value="AF">Afghanistan</option>
<option value="AG">Antigua and Barbuda</option>
<option value="AI">Anguilla</option>
<option value="AL">Albania</option>
<option value="AM">Armenia</option>
<option value="AO">Angola</option>
<option value="AQ">Antarctica</option>
<option value="AR">Argentina</option>
<option value="AS">American Samoa</option>
<option value="AT">Austria</option>
<option value="AU">Australia</option>
<option value="AW">Aruba</option>
<option value="AX">Åland Islands</option>
<option value="AZ">Azerbaijan</option>
<option value="BA">Bosnia and Herzegovina</option>
<option value="BB">Barbados</option>
<option value="BD">Bangladesh</option>
<option value="BE">Belgium</option>
<option value="BF">Burkina Faso</option>
<option value="BG">Bulgaria</option>
<option value="BH">Bahrain</option>
<option value="BI">Burundi</option>
<option value="BJ">Benin</option>
<option value="BL">Saint Barthélemy</option>
<option value="BM">Bermuda</option>
<option value="BN">Brunei Darussalam</option>
<option value="BO">Bolivia, Plurinational State of</option>
<option value="BQ">Bonaire, Sint Eustatius and Saba</option>
<option value="BR">Brazil</option>
<option value="BS">Bahamas</option>
<option value="BT">Bhutan</option>
<option value="BW">Botswana</option>
<option value="BY">Belarus</option>
<option value="BZ">Belize</option>
<option value="CA">Canada</option>
<option value="CC">Cocos (Keeling) Islands</option>
<option value="CD">Congo, the Democratic Republic of the</option>
<option value="CF">Central African Republic</option>
<option value="CG">Congo</option>
<option value="CH">Switzerland</option>
<option value="CI">Côte d'Ivoire</option>
<option value="CK">Cook Islands</option>
<option value="CL">Chile</option>
<option value="CM">Cameroon</option>
<option value="CN">China</option>
<option value="CO">Colombia</option>
<option value="CR">Costa Rica</option>
<option value="CU">Cuba</option>
<option value="CV">Cabo Verde</option>
<option value="CW">Curaçao</option>
<option value="CX">Christmas Island</option>
<option value="CY">Cyprus</option>
<option value="CZ">Czechia</option>
<option value="DE">Germany</option>
<option value="DJ">Djibouti</option>
<option value="DK">Denmark</option>
<option value="DM">Dominica</option>
<option value="DO">Dominican Republic</option>
<option value="DZ">Algeria</option>
<option value="EC">Ecuador</option>
<option value="EE">Estonia</option>
<option value="EG">Egypt</option>
<option value="EH">Western Sahara</option>
<option value="ER">Eritrea</option>
<option value="ES">Spain</option>
<option value="ET">Ethiopia</option>
<option value="FI">Finland</option>
<option value="FJ">Fiji</option>
<option value="FK">Falkland Islands (Malvinas)</option>
<option value="FM">Micronesia, Federated States of</option>
<option value="FO">Faroe Islands</option>
<option value="FR">France</option>
<option value="GA">Gabon</option>
<option value="GB">United Kingdom</option>
<option value="GD">Grenada</option>
<option value="GE">Georgia</option>
<option value="GF">French Guiana</option>
<option value="GG">Guernsey</option>
<option value="GH">Ghana</option>
<option value="GI">Gibraltar</option>
<option value="GL">Greenland</option>
<option value="GM">Gambia</option>
<option value="GN">Guinea</option>
<option value="GP">Guadeloupe</option>
<option value="GQ">Equatorial Guinea</option>
<option value="GR">Greece</option>
<option value="GS">South Georgia and the South Sandwich Islands</option>
<option value="GT">Guatemala</option>
<option value="GU">Guam</option>
<option value="GW">Guinea-Bissau</option>
<option value="GY">Guyana</option>
<option value="HK">Hong Kong</option>
<option value="HN">Honduras</option>
<option value="HR">Croatia</option>
<option value="HT">Haiti</option>
<option value="HU">Hungary</option>
<option value="ID">Indonesia</option>
<option value="IE">Ireland</option>
<option value="IL">Israel</option>
<option value="IM">Isle of Man</option>
<option value="IN">India</option>
<option value="IO">British Indian Ocean Territory</option>
<option value="IQ">Iraq</option>
<option value="IR">Iran, Islamic Republic of</option>
<option value="IS">Iceland</option>
<option value="IT">Italy</option>
<option value="JE">Jersey</option>
<option value="JM">Jamaica</option>
<option value="JO">Jordan</option>
<option value="JP">Japan</option>
<option value="KE">Kenya</option>
<option value="KG">Kyrgyzstan</option>
<option value="KH">Cambodia</option>
<option value="KI">Kiribati</option>
<option value="KM">Comoros</option>
<option value="KN">Saint Kitts and Nevis</option>
<option value="KP">Korea (the Democratic People's Republic of)</option>
<option value="KR">Korea (the Republic of)</option>
<option value="KW">Kuwait</option>
<option value="KY">Cayman Islands</option>
<option value="KZ">Kazakhstan</option>
<option value="LA">Lao People's Democratic Republic</option>
<option value="LB">Lebanon</option>
<option value="LC">Saint Lucia</option>
<option value="LI">Liechtenstein</option>
<option value="LK">Sri Lanka</option>
<option value="LR">Liberia</option>
<option value="LS">Lesotho</option>
<option value="LT">Lithuania</option>
<option value="LU">Luxembourg</option>
<option value="LV">Latvia</option>
<option value="LY">Libya</option>
<option value="MA">Morocco</option>
<option value="MC">Monaco</option>
<option value="MD">Moldova, Republic of</option>
<option value="ME">Montenegro</option>
<option value="MF">Saint Martin (French part)</option>
<option value="MG">Madagascar</option>
<option value="MH">Marshall Islands</option>
<option value="MK">Macedonia, the former Yugoslav Republic of</option>
<option value="ML">Mali</option>
<option value="MM">Myanmar</option>
<option value="MN">Mongolia</option>
<option value="MO">Macao</option>
<option value="MP">Northern Mariana Islands</option>
<option value="MQ">Martinique</option>
<option value="MR">Mauritania</option>
<option value="MS">Montserrat</option>
<option value="MT">Malta</option>
<option value="MU">Mauritius</option>
<option value="MV">Maldives</option>
<option value="MW">Malawi</option>
<option value="MX">Mexico</option>
<option value="MY">Malaysia</option>
<option value="MZ">Mozambique</option>
<option value="NA">Namibia</option>
<option value="NC">New Caledonia</option>
<option value="NE">Niger</option>
<option value="NF">Norfolk Island</option>
<option value="NG">Nigeria</option>
<option value="NI">Nicaragua</option>
<option value="NL">Netherlands</option>
<option value="NO">Norway</option>
<option value="NP">Nepal</option>
<option value="NR">Nauru</option>
<option value="NU">Niue</option>
<option value="NZ">New Zealand</option>
<option value="OM">Oman</option>
<option value="PA">Panama</option>
<option value="PE">Peru</option>
<option value="PF">French Polynesia</option>
<option value="PG">Papua New Guinea</option>
<option value="PH">Philippines</option>
<option value="PK">Pakistan</option>
<option value="PL">Poland</option>
<option value="PM">Saint Pierre and Miquelon</option>
<option value="PN">Pitcairn</option>
<option value="PR">Puerto Rico</option>
<option value="PS">Palestine, State of</option>
<option value="PT">Portugal</option>
<option value="PW">Palau</option>
<option value="PY">Paraguay</option>
<option value="QA">Qatar</option>
<option value="RE">Réunion</option>
<option value="RO">Romania</option>
<option value="RS">Serbia</option>
<option value="RU">Russian Federation</option>
<option value="RW">Rwanda</option>
<option value="SA">Saudi Arabia</option>
<option value="SB">Solomon Islands</option>
<option value="SC">Seychelles</option>
<option value="SD">Sudan</option>
<option value="SE">Sweden</option>
<option value="SG">Singapore</option>
<option value="SH">Saint Helena, Ascension and Tristan da Cunha</option>
<option value="SI">Slovenia</option>
<option value="SJ">Svalbard and Jan Mayen</option>
<option value="SK">Slovakia</option>
<option value="SL">Sierra Leone</option>
<option value="SM">San Marino</option>
<option value="SN">Senegal</option>
<option value="SO">Somalia</option>
<option value="SR">Suriname</option>
<option value="SS">South Sudan</option>
<option value="ST">Sao Tome and Principe</option>
<option value="SV">El Salvador</option>
<option value="SX">Sint Maarten (Dutch part)</option>
<option value="SY">Syrian Arab Republic</option>
<option value="SZ">Swaziland</option>
<option value="TC">Turks and Caicos Islands</option>
<option value="TD">Chad</option>
<option value="TF">French Southern Territories</option>
<option value="TG">Togo</option>
<option value="TH">Thailand</option>
<option value="TJ">Tajikistan</option>
<option value="TK">Tokelau</option>
<option value="TL">Timor-Leste</option>
<option value="TM">Turkmenistan</option>
<option value="TN">Tunisia</option>
<option value="TO">Tonga</option>
<option value="TR">Turkey</option>
<option value="TT">Trinidad and Tobago</option>
<option value="TV">Tuvalu</option>
<option value="TW">Taiwan, Province of China</option>
<option value="TZ">Tanzania, United Republic of</option>
<option value="UA">Ukraine</option>
<option value="UG">Uganda</option>
<option value="UM">United States Minor Outlying Islands</option>
<option value="US">United States</option>
<option value="UY">Uruguay</option>
<option value="UZ">Uzbekistan</option>
<option value="VA">Holy See (Vatican City State)</option>
<option value="VC">Saint Vincent and the Grenadines</option>
<option value="VE">Venezuela, Bolivarian Republic of</option>
<option value="VG">Virgin Islands, British</option>
<option value="VI">Virgin Islands, U.S.</option>
<option value="VN">Viet Nam</option>
<option value="VU">Vanuatu</option>
<option value="WF">Wallis and Futuna</option>
<option value="WS">Samoa</option>
<option value="YE">Yemen</option>
<option value="YT">Mayotte</option>
<option value="ZA">South Africa</option>
<option value="ZM">Zambia</option>
<option value="ZW">Zimbabwe</option>
</select>
</div>
	
    </div>
	<div class="item" id="CurrRegion">
	Current region&nbsp;:&nbsp;<div class="ts active inline mini loader"></div>
    </div>
    <div class="item" id="AvaRegion">
	Available timezone&nbsp;:&nbsp;<div class="ts active inline mini loader"></div>
	<div class="ts grid" id="AvaRegionBtn">&nbsp;</div>
	
    </div>
	<div class="item"  id="CurrTime">
	Loading currrent setting...<div class="ts active inline mini loader"></div>
    </div>
</div>
</div>



      <div class="ts bottom right snackbar">
         <div class="content"></div>	
      </div>
<script>
startup();
var cur = new Date("1900-01-01 00:00:00");
var savedregionhtml = [];
var selectedregionhtml = [];
var tz = "";

function startup(){
//Please ADD ALL LOAD ON STARTUP SCRIPT HERE
UpdateTime();
setInterval(ShowTime, 1000);
setInterval(UpdateTime, 30000);
CurrIP();
}

function ShowTime(){
	cur.setSeconds(cur.getSeconds() + 1);
	var formatted = cur.toLocaleDateString('en-US') + " " + cur.toLocaleTimeString('en-US');	 
	$( "#CurrTime" ).html("Current Time : ".concat(formatted," (",tz,")"));
	}


function CurrIP(){
$.getJSON("../extIP.php", function (data) {
	
	if(data !== null){
	CurrRegion(data);
	UpdateTime();
	}else{
		msg("System encounters an error.")
	}
});
}

function change(tz){
	SpeRegion($(tz).val());
}

function CurrRegion(ip){
$.getJSON("./script/ip2iso_countrycode.php?ip=" + ip, function (data) {
	$("#CurrRegion").text("Current Region : " + data );
	AvaRegion(data);
});
}

function AvaRegion(region){
	savedregionhtml = [];
	$.getJSON("./script/iso_countrycode2timezone.php?timezone=" + region, function (data) {
	$.each(data, function(i, field){
        savedregionhtml.push('<div class="stretched column"><button class="ts very compact mini positive button" onclick="changetimezone(this)" tz="' + field + '">' + field + "</button></div>");
    });
	push();
});

}


function SpeRegion(region){
	selectedregionhtml = [];
	$.getJSON("./script/iso_countrycode2timezone.php?timezone=" + region, function (data) {
	$.each(data, function(i, field){
        selectedregionhtml.push('<div class="stretched column"><button class="ts very compact mini info button" onclick="changetimezone(this)" tz="' + field + '">' + field + "</button></div>");
    });
	push();
});

}

function push(){
	$("#AvaRegion").html('Available timezone&nbsp;:&nbsp;<div class="ts relaxed grid" id="AvaRegionBtn">&nbsp;</div>');
	var push = [];
	push = savedregionhtml.concat(selectedregionhtml);
	$("#AvaRegionBtn").append(push);
}

function UpdateTime(){
	
	$.getJSON("time_bg.php?opr=query", function (data) {
		cur = new Date(data["time"]);
		tz = data["timezone"];
	});
}

function changetimezone(tz){
	$.ajax({url:"time_bg.php?opr=edit&timezone=" + $(tz).attr("tz"),async:false});
	msg("Success.");
	UpdateTime();
}



function msg(content) {
	ts('.snackbar').snackbar({
		content: content,
		actionEmphasis: 'negative',
	});
}



</script>
</body>
</html>