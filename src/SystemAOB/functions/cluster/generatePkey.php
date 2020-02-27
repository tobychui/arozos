<?php

function gen_uuid() {
 $uuid = array(
  'time_low'  => 0,
  'time_mid'  => 0,
  'time_hi'  => 0,
  'clock_seq_hi' => 0,
  'clock_seq_low' => 0,
  'node'   => array()
 );

 $uuid['time_low'] = mt_rand(0, 0xffff) + (mt_rand(0, 0xffff) << 16);
 $uuid['time_mid'] = mt_rand(0, 0xffff);
 $uuid['time_hi'] = (4 << 12) | (mt_rand(0, 0x1000));
 $uuid['clock_seq_hi'] = (1 << 7) | (mt_rand(0, 128));
 $uuid['clock_seq_low'] = mt_rand(0, 255);

 for ($i = 0; $i < 6; $i++) {
  $uuid['node'][$i] = mt_rand(0, 255);
 }

 $uuid = sprintf('%08x-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x',
  $uuid['time_low'],
  $uuid['time_mid'],
  $uuid['time_hi'],
  $uuid['clock_seq_hi'],
  $uuid['clock_seq_low'],
  $uuid['node'][0],
  $uuid['node'][1],
  $uuid['node'][2],
  $uuid['node'][3],
  $uuid['node'][4],
  $uuid['node'][5]
 );

 return $uuid;
}


include_once("../../../auth.php");
set_include_path(realpath("../../../script/phpseclib"));
include_once("../user/userIsolation.php");
$systemPath = getSystemDirectory();
$writePath = $systemPath . "keypairs/";
if (!file_exists($writePath)){
    mkdir($writePath,0777,true);
}
$uuid = gen_uuid();
$privateKeyFile = $writePath . $uuid . "_rsa";
$publicKeyFile = $writePath . $uuid . "_rsa.pub";
include_once('Crypt/RSA.php');
$rsa = new Crypt_RSA();
extract($rsa->createKey());

file_put_contents($privateKeyFile,$privatekey);
file_put_contents($publicKeyFile,$publickey);

echo $uuid;
exit(0);
?>