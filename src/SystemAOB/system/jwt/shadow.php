<?php
/*
ArOZ Online JSON Web Token Shadow Runner Script
WARNING! This script is designed to be used with AROZ Online System and it is critical for the security of the system
DO NOT CHANGE ANYLINE / COPY AND PASTE ANYTHING FROM THE INETERNET TO THIS SCRIPT IF YOU DO NOT KNOW WHAT YOU ARE DOING.


To use this script, include this the same way you do with auth.php.
** If you have included this script, it is NOT NECESSARY to include auth.php again as their function is duplicated.
For example, if you script require GET variable: filename and filepath, after including the jwt/shadow.php, you are required to pass in the token as an extra GET variable
Here is an example:

test.php?filename=filenameHere&filepath=filepathHere&token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI.....

If the token request failed, the script will return the result as a standard ArOZ Error Message starting with "ERROR" and error message.
*/

//Recursive upward check for root path
$maxAuthscriptDepth = 32;
$rootPath = "";
if (file_exists("root.inf")){
	//The script is running on the root folder
}else{
	//The script is not running on the root folder, find upward and see where is the root file is placed.
	for ($x = 0; $x <= $maxAuthscriptDepth; $x++) {
		if (file_exists($rootPath . "/root.inf")){
			break;
		}else{
			$rootPath = $rootPath . "../";
		}
	} 
}
//Try to extract the system config directory without auth.php
$sysConfigDir = "/etc/AOB/";
if (filesize($rootPath . "root.inf") != 0){
	$sysConfigDir = file_get_contents($rootPath . "root.inf");
}else{
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		$sysConfigDir = "C:/AOB/";
	}else{
		$sysConfigDir = "/etc/AOB/";
	}
}



/**
 * JSON Web Token implementation, based on this spec:
 * https://tools.ietf.org/html/rfc7519
 * 
 * This class library is based on original Firebase/JWT source code written by 
 * Neuman Vong and Anant Narayanan found here: https://github.com/firebase/php-jwt
 * 
 * @license  http://opensource.org/licenses/BSD-3-Clause 3-clause BSD
 * 
 */
class JWT {

    public static $leeway = 0;                      // allows for nbf, iat or exp clock skew
    public static $timestamp = null;                // allow timestamp to be specified for testing. Defaults to php (time) if null.
    public static $supported_algs = array(
        'HS256' => array('hash_hmac', 'SHA256'),
        'HS512' => array('hash_hmac', 'SHA512'),
        'HS384' => array('hash_hmac', 'SHA384'),
        'RS256' => array('openssl', 'SHA256'),
        'RS384' => array('openssl', 'SHA384'),
        'RS512' => array('openssl', 'SHA512'),
    );
    /** ----------------------------------------------------------------------------------------------------------
     * Decodes a JWT string into a PHP object.
     *
     * @param string        $token          The JSON web token
     * @param string|array  $key            The secret key                            
     * @param array         $allowed_algs   If the algorithm used is asymmetric, this is the public key list
     *                                      of supported verification algorithms. Supported algorithms are:
     *                                      'HS256', 'HS384', 'HS512' and 'RS256'
     *
     * @return object The JWT's payload as a PHP object
     *
     */
    public static function decode($token, $key, array $allowed_algs = array())
    {
        if ((!isset($timestamp)) || (is_null($timestamp))) {
            $timestamp = time();
        }
        
        if (empty($key)) {
            throw new Exception('Invalid or missing key.');
        }

        $tokenSegments = explode('.', $token);

        if (count($tokenSegments) != 3) {
            throw new Exception('Wrong number of segments');
        }

        list($headb64, $bodyb64, $cryptob64) = $tokenSegments;
        if (null === ($header = static::jsonDecode(static::urlsafeB64Decode($headb64)))) {
            throw new Exception('Invalid header encoding');
        }

        if (null === $payload = static::jsonDecode(static::urlsafeB64Decode($bodyb64))) {
            throw new Exception('Invalid claims encoding');
        }

        if (false === ($sig = static::urlsafeB64Decode($cryptob64))) {
            throw new Exception('Invalid signature encoding');
        }

        if (empty($header->alg)) {
            throw new Exception('Empty algorithm');
        }

        if (empty(static::$supported_algs[$header->alg])) {
            throw new Exception('Algorithm not supported');
        }

        if (!in_array($header->alg, $allowed_algs)) {
            throw new Exception('Algorithm not allowed');
        }

        if (is_array($key) || $key instanceof ArrayAccess) {
            if (isset($header->kid)) {
                if (!isset($key[$header->kid])) {
                    throw new UnexpectedValueException('"kid" invalid, unable to lookup correct key');
                }
                $key = $key[$header->kid];
            } else {
                throw new UnexpectedValueException('"kid" empty, unable to lookup correct key');
            }
        }

        // Check the signature
        if (!static::verify("$headb64.$bodyb64", $sig, $key, $header->alg)) {
            throw new Exception('Signature verification failed');
        }

        // Check if the nbf if it is defined. This is the time that the
        // token can actually be used. If it's not yet that time, abort.
        if (isset($payload->nbf) && $payload->nbf > ($timestamp + static::$leeway)) {
            throw new Exception(
                'Cannot handle token prior to ' . date(DateTime::ISO8601, $payload->nbf)
            );
        }

        // Check that this token has been created before 'now'. This prevents
        // using tokens that have been created for later use (and haven't
        // correctly used the nbf claim).
        if (isset($payload->iat) && $payload->iat > ($timestamp + static::$leeway)) {
            throw new Exception(
                'Cannot handle token prior to ' . date(DateTime::ISO8601, $payload->iat)
            );
        }
        
        // Check if this token has expired.
        if (isset($payload->exp) && ($timestamp - static::$leeway) >= $payload->exp) {
            throw new Exception('Expired token');
        }

        return $payload;
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Converts and signs a PHP object or array into a JWT string.
     *
     * @param object|array  $payload    PHP object or array
     * @param string        $key        The secret key.
     *                                  If the algorithm used is asymmetric, this is the private key
     * @param string        $alg        The signing algorithm.
     *                                  Supported algorithms are 'HS256', 'HS384', 'HS512' and 'RS256'
     * @param mixed         $keyId
     * @param array         $head       An array with header elements to attach
     *
     * @return string A signed JWT
     *
     */
    public static function encode($payload, $key, $alg = 'HS256', $keyId = null, $head = null)
    {
        $header = array('typ' => 'JWT', 'alg' => $alg);

        if ($keyId !== null) {
            $header['kid'] = $keyId;
        }

        if ( isset($head) && is_array($head) ) {
            $header = array_merge($head, $header);
        }

        $segments = array();
        $segments[] = static::urlsafeB64Encode(static::jsonEncode($header));
        $segments[] = static::urlsafeB64Encode(static::jsonEncode($payload));
        $signing_input = implode('.', $segments);
        $signature = static::sign($signing_input, $key, $alg);
        $segments[] = static::urlsafeB64Encode($signature);

        return implode('.', $segments);
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Sign a string with a given key and algorithm.
     *
     * @param string            $msg    The message to sign
     * @param string|resource   $key    The secret key
     * @param string            $alg    The signing algorithm.
     *                                  Supported algorithms are 'HS256', 'HS384', 'HS512' and 'RS256'
     *
     * @return string An encrypted message
     *
     */
    public static function sign($msg, $key, $alg = 'HS256')
    {
        if (empty(static::$supported_algs[$alg])) {
            throw new Exception('Algorithm not supported');
        }
        list($function, $algorithm) = static::$supported_algs[$alg];
        switch($function) {
            case 'hash_hmac':
                return hash_hmac($algorithm, $msg, $key, true);
            case 'openssl':
                $signature = '';
                $success = openssl_sign($msg, $signature, $key, $algorithm);
                if (!$success) {
                    throw new Exception("OpenSSL unable to sign data");
                } else {
                    return $signature;
                }
        }
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Verify a signature with the message, key and method. Not all methods
     * are symmetric, so we must have a separate verify and sign method.
     *
     * @param string            $msg        The original message (header and body)
     * @param string            $signature  The original signature
     * @param string|resource   $key        For HS*, a string key works. for RS*, must be a resource of an openssl public key
     * @param string            $alg        The algorithm
     *
     * @return bool
     */
    private static function verify($msg, $signature, $key, $alg)
    {
        if (empty(static::$supported_algs[$alg])) {
            throw new Exception('Algorithm not supported');
        }
        list($function, $algorithm) = static::$supported_algs[$alg];
        switch($function) {
            case 'openssl':
                $success = openssl_verify($msg, $signature, $key, $algorithm);
                if ($success === 1) {
                    return true;
                } elseif ($success === 0) {
                    return false;
                }
                // returns 1 on success, 0 on failure, -1 on error.
                throw new Exception(
                    'OpenSSL error: ' . openssl_error_string()
                );
            case 'hash_hmac':
            default:
                $hash = hash_hmac($algorithm, $msg, $key, true);
                if (function_exists('hash_equals')) {
                    return hash_equals($signature, $hash);
                }
                $len = min(static::safeStrlen($signature), static::safeStrlen($hash));
                $status = 0;
                for ($i = 0; $i < $len; $i++) {
                    $status |= (ord($signature[$i]) ^ ord($hash[$i]));
                }
                $status |= (static::safeStrlen($signature) ^ static::safeStrlen($hash));
                return ($status === 0);
        }
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Decode a JSON string into a PHP object.
     *
     * @param string $input JSON string
     *
     * @return object Object representation of JSON string
     *
     * @throws Exception Provided string was invalid JSON
     */
    public static function jsonDecode($input)
    {
        if (version_compare(PHP_VERSION, '5.4.0', '>=') && !(defined('JSON_C_VERSION') && PHP_INT_SIZE > 4)) {
            /** In PHP >=5.4.0, json_decode() accepts an options parameter, that allows you
             * to specify that large ints (like Steam Transaction IDs) should be treated as
             * strings, rather than the PHP default behaviour of converting them to floats.
             */
            $obj = json_decode($input, false, 512, JSON_BIGINT_AS_STRING);
        } else {
            /** Not all servers will support that, however, so for older versions we must
             * manually detect large ints in the JSON string and quote them (thus converting
             *them to strings) before decoding, hence the preg_replace() call.
             */
            $max_int_length = strlen((string) PHP_INT_MAX) - 1;
            $json_without_bigints = preg_replace('/:\s*(-?\d{'.$max_int_length.',})/', ': "$1"', $input);
            $obj = json_decode($json_without_bigints);
        }
        if (function_exists('json_last_error') && $errno = json_last_error()) {
            static::handleJsonError($errno);
        } elseif ($obj === null && $input !== 'null') {
            throw new Exception('Null result with non-null input');
        }
        return $obj;
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Encode a PHP object into a JSON string.
     *
     * @param object|array $input A PHP object or array
     *
     * @return string JSON representation of the PHP object or array
     *
     * @throws Exception Provided object could not be encoded to valid JSON
     */
    public static function jsonEncode($input)
    {
        $json = json_encode($input);
        if (function_exists('json_last_error') && $errno = json_last_error()) {
            static::handleJsonError($errno);
        } elseif ($json === 'null' && $input !== null) {
            throw new Exception('Null result with non-null input');
        }
        return $json;
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Decode a string with URL-safe Base64.
     *
     * @param string $input A Base64 encoded string
     *
     * @return string A decoded string
     */
    public static function urlsafeB64Decode($input)
    {
        $remainder = strlen($input) % 4;
        if ($remainder) {
            $padlen = 4 - $remainder;
            $input .= str_repeat('=', $padlen);
        }
        return base64_decode(strtr($input, '-_', '+/'));
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Encode a string with URL-safe Base64.
     *
     * @param string $input The string you want encoded
     *
     * @return string The base64 encode of what you passed in
     */
    public static function urlsafeB64Encode($input)
    {
        return str_replace('=', '', strtr(base64_encode($input), '+/', '-_'));
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Helper method to create a JSON error.
     *
     * @param int $errno An error number from json_last_error()
     *
     * @return void
     */
    private static function handleJsonError($errno)
    {
        $messages = array(
            JSON_ERROR_DEPTH => 'Maximum stack depth exceeded',
            JSON_ERROR_STATE_MISMATCH => 'Invalid or malformed JSON',
            JSON_ERROR_CTRL_CHAR => 'Unexpected control character found',
            JSON_ERROR_SYNTAX => 'Syntax error, malformed JSON',
            JSON_ERROR_UTF8 => 'Malformed UTF-8 characters' //PHP >= 5.3.3
        );
        throw new Exception(
            isset($messages[$errno])
            ? $messages[$errno]
            : 'Unknown JSON error: ' . $errno
        );
    }
    /** ----------------------------------------------------------------------------------------------------------
     * Get the number of bytes in cryptographic strings.
     *
     * @param string
     *
     * @return int
     */
    private static function safeStrlen($str)
    {
        if (function_exists('mb_strlen')) {
            return mb_strlen($str, '8bit');
        }
        return strlen($str);
    }
}

$token = null;
//Check if the given token is valid
if (isset($_GET['token'])) {$token = $_GET['token'];}
$keyFileLocation = $sysConfigDir . "serverkey/deviceKey.akey";
if (!file_exists($keyFileLocation)){
	$returnArray = array('error' => 'This device do not have a server key. To validate a self generated token, you must call create.php once.');
}

if (!is_null($token)) {

	// Get our server-side secret key from a secure location.
	$serverKey = trim(file_get_contents($keyFileLocation));
	
	try {
		$payload = JWT::decode($token, $serverKey, array('HS256'));
		$returnArray = array('username' => $payload->user, 'signDevice' => $payload->sgd , 'createdTime' => $payload->crd);
		if (isset($payload->exp)) {
			$returnArray['expTime'] = $payload->exp;
		}else{
			$returnArray['expTime'] = -1;
		}
	}
	catch(Exception $e) {
		$returnArray = array('error' => $e->getMessage());
	}
	$hashedToken = hash('sha512',$_GET['token']);
	if (file_exists("tokenDB/" . $hashedToken . ".atok")){
		$returnArray['localGenerated'] = true;
	}else{
		$returnArray['localGenerated'] = false;
	}
} 
else {
	$returnArray = array('error' => 'Token not given.');
}

if (key_exists("error",$returnArray)){
	die("ERROR. Shadow Runner failed to initiate. " . $returnArray["error"]);
}

//Start shadow process with given token information
session_start();
$_SESSION['token'] = $returnArray['username'];

?>