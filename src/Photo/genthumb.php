<?php
include '../auth.php';
?>
<?php

/*
Title:      Thumb.php
URL:        http://github.com/jamiebicknell/Thumb
Author:     Jamie Bicknell
Twitter:    @jamiebicknell
*/

define('THUMB_CACHE',           'cache/');    // Path to cache directory (must be writeable)
define('THUMB_CACHE_AGE',       86400);         // Duration of cached files in seconds
define('THUMB_BROWSER_CACHE',   true);          // Browser cache true or false
define('SHARPEN_MIN',           12);            // Minimum sharpen value
define('SHARPEN_MAX',           28);            // Maximum sharpen value
define('ADJUST_ORIENTATION',    true);          // Auto adjust orientation for JPEG true or false
define('JPEG_QUALITY',          100);           // Quality of generated JPEGs (0 - 100; 100 being best)

$src = isset($_GET['src']) ? $_GET['src'] : false;
$size = isset($_GET['size']) ? str_replace(array('<', 'x'), '', $_GET['size']) != '' ? $_GET['size'] : 100 : 100;
$crop = isset($_GET['crop']) ? max(0, min(1, $_GET['crop'])) : 1;
$trim = isset($_GET['trim']) ? max(0, min(1, $_GET['trim'])) : 0;
$zoom = isset($_GET['zoom']) ? max(0, min(1, $_GET['zoom'])) : 0;
$align = isset($_GET['align']) ? $_GET['align'] : false;
$sharpen = isset($_GET['sharpen']) ? max(0, min(100, $_GET['sharpen'])) : 0;
$gray = isset($_GET['gray']) ? max(0, min(1, $_GET['gray'])) : 0;
$ignore = isset($_GET['ignore']) ? max(0, min(1, $_GET['ignore'])) : 0;
$path = parse_url($src);

if (isset($path['scheme'])) {
    $base = parse_url('http://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI']);
    if (preg_replace('/^www\./i', '', $base['host']) == preg_replace('/^www\./i', '', $path['host'])) {
        $base = explode('/', preg_replace('/\/+/', '/', $base['path']));
        $path = explode('/', preg_replace('/\/+/', '/', $path['path']));
        $temp = $path;
        $part = count($base);
        foreach ($base as $k => $v) {
            if ($v == $path[$k]) {
                array_shift($temp);
            } else {
                if ($part - $k > 1) {
                    $temp = array_pad($temp, 0 - (count($temp) + ($part - $k) - 1), '..');
                    break;
                } else {
                    $temp[0] = './' . $temp[0];
                }
            }
        }
        $src = implode('/', $temp);
    }
}
$src = iconv('utf-8','big-5',$src);

if (!extension_loaded('gd')) {
    die('GD extension is not installed');
}
if (!is_writable(THUMB_CACHE)) {
    die('Cache not writable');
}
if (isset($path['scheme']) || !file_exists($src)) {
    die('File cannot be found'.$src);
}
if (!in_array(strtolower(substr(strrchr($src, '.'), 1)), array('gif', 'jpg', 'jpeg', 'png'))) {
    die('File is not an image');
}

$file_salt = 'v1.0.5';
$file_size = filesize($src);
$file_time = filemtime($src);
$file_date = gmdate('D, d M Y H:i:s T', $file_time);
$file_type = strtolower(substr(strrchr($src, '.'), 1));
$file_hash = md5($file_salt . ($src.$size.$crop.$trim.$zoom.$align.$sharpen.$gray.$ignore) . $file_time);
$file_temp = THUMB_CACHE . $file_hash . '.img.txt';
$file_name = basename(substr($src, 0, strrpos($src, '.')) . strtolower(strrchr($src, '.')));

if (!file_exists(THUMB_CACHE . 'index.html')) {
    touch(THUMB_CACHE . 'index.html');
}
if (($fp = fopen(THUMB_CACHE . 'index.html', 'r')) !== false) {
    if (flock($fp, LOCK_EX)) {
        if (time() - THUMB_CACHE_AGE > filemtime(THUMB_CACHE . 'index.html')) {
            $files = glob(THUMB_CACHE . '*.img.txt');
            if (is_array($files) && count($files) > 0) {
                foreach ($files as $file) {
                    if (time() - THUMB_CACHE_AGE > filemtime($file)) {
                        unlink($file);
                    }
                }
            }
            touch(THUMB_CACHE . 'index.html');
        }
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

if (THUMB_BROWSER_CACHE && (isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) || isset($_SERVER['HTTP_IF_NONE_MATCH']))) {
    if ($_SERVER['HTTP_IF_MODIFIED_SINCE'] == $file_date && $_SERVER['HTTP_IF_NONE_MATCH'] == $file_hash) {
        header($_SERVER['SERVER_PROTOCOL'] . ' 304 Not Modified');
        die();
    }
}

if (!file_exists($file_temp)) {
    list($w0, $h0, $type) = getimagesize($src);
    $data = file_get_contents($src);
    if ($ignore && $type == 1) {
        if (preg_match('/\x00\x21\xF9\x04.{4}\x00(\x2C|\x21)/s', $data)) {
            header('Content-Type: image/gif');
            header('Content-Length: ' . $file_size);
            header('Content-Disposition: inline; filename="' . $file_name . '"');
            header('Last-Modified: ' . $file_date);
            header('ETag: ' . $file_hash);
            header('Accept-Ranges: none');
            if (THUMB_BROWSER_CACHE) {
                header('Cache-Control: max-age=604800, must-revalidate');
                header('Expires: ' . gmdate('D, d M Y H:i:s T', strtotime('+7 days')));
            } else {
                header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
                header('Expires: ' . gmdate('D, d M Y H:i:s T'));
                header('Pragma: no-cache');
            }
            die($data);
        }
    }
    $oi = imagecreatefromstring($data);
    if (function_exists('exif_read_data') && ADJUST_ORIENTATION && $type == 2) {
        // I know supressing errors is bad, but calling exif_read_data on invalid
        // or corrupted data returns a fatal error and there's no way to validate
        // the EXIF data before calling the function.
        $exif = @exif_read_data($src, EXIF);
        if (isset($exif['Orientation'])) {
            $degree = 0;
            $mirror = false;
            switch ($exif['Orientation']) {
                case 2:
                    $mirror = true;
                    break;
                case 3:
                    $degree = 180;
                    break;
                case 4:
                    $degree = 180;
                    $mirror = true;
                    break;
                case 5:
                    $degree = 270;
                    $mirror = true;
                    $w0 ^= $h0 ^= $w0 ^= $h0;
                    break;
                case 6:
                    $degree = 270;
                    $w0 ^= $h0 ^= $w0 ^= $h0;
                    break;
                case 7:
                    $degree = 90;
                    $mirror = true;
                    $w0 ^= $h0 ^= $w0 ^= $h0;
                    break;
                case 8:
                    $degree = 90;
                    $w0 ^= $h0 ^= $w0 ^= $h0;
                    break;
            }
            if ($degree > 0) {
                $oi = imagerotate($oi, $degree, 0);
            }
            if ($mirror) {
                $nm = $oi;
                $oi = imagecreatetruecolor($w0, $h0);
                imagecopyresampled($oi, $nm, 0, 0, $w0 - 1, 0, $w0, $h0, -$w0, $h0);
                imagedestroy($nm);
            }
        }
    }
    list($w,$h) = explode('x', str_replace('<', '', $size) . 'x');
    $w = ($w != '') ? floor(max(8, min(1500, $w))) : '';
    $h = ($h != '') ? floor(max(8, min(1500, $h))) : '';
    if (strstr($size, '<')) {
        $h = $w;
        $crop = 0;
        $trim = 1;
    } elseif (!strstr($size, 'x')) {
        $h = $w;
    } elseif ($w == '' || $h == '') {
        $w = ($w == '') ? ($w0 * $h) / $h0 : $w;
        $h = ($h == '') ? ($h0 * $w) / $w0 : $h;
        $crop = 0;
        $trim = 1;
    }
    $trim_w = ($trim) ? 1 : ($w == '') ? 1 : 0;
    $trim_h = ($trim) ? 1 : ($h == '') ? 1 : 0;
    if ($crop) {
        $w1 = (($w0 / $h0) > ($w / $h)) ? floor($w0 * $h / $h0) : $w;
        $h1 = (($w0 / $h0) < ($w / $h)) ? floor($h0 * $w / $w0) : $h;
        if (!$zoom) {
            if ($h0 < $h || $w0 < $w) {
                $w1 = $w0;
                $h1 = $h0;
            }
        }
    } else {
        $w1 = (($w0 / $h0) < ($w / $h)) ? floor($w0 * $h / $h0) : floor($w);
        $h1 = (($w0 / $h0) > ($w / $h)) ? floor($h0 * $w / $w0) : floor($h);
        $w = floor($w);
        $h = floor($h);
        if (!$zoom) {
            if ($h0 < $h && $w0 < $w) {
                $w1 = $w0;
                $h1 = $h0;
            }
        }
    }
    $w = ($trim_w) ? (($w0 / $h0) > ($w / $h)) ? min($w, $w1) : $w1 : $w;
    $h = ($trim_h) ? (($w0 / $h0) < ($w / $h)) ? min($h, $h1) : $h1 : $h;
    if ($sharpen) {
        $matrix = array (
            array(-1, -1, -1),
            array(-1, SHARPEN_MAX - ($sharpen * (SHARPEN_MAX - SHARPEN_MIN)) / 100, -1),
            array(-1, -1, -1));
        $divisor = array_sum(array_map('array_sum', $matrix));
    }
    $x = strpos($align, 'l') !== false ? 0 : (strpos($align, 'r') !== false ? $w - $w1 : ($w - $w1) / 2);
    $y = strpos($align, 't') !== false ? 0 : (strpos($align, 'b') !== false ? $h - $h1 : ($h - $h1) / 2);
    $im = imagecreatetruecolor($w, $h);
    $bg = imagecolorallocate($im, 255, 255, 255);
    imagefill($im, 0, 0, $bg);
    switch ($type) {
        case 1:
            imagecopyresampled($im, $oi, $x, $y, 0, 0, $w1, $h1, $w0, $h0);
            if ($sharpen && version_compare(PHP_VERSION, '5.1.0', '>=')) {
                imageconvolution($im, $matrix, $divisor, 0);
            }
            if ($gray) {
                imagefilter($im, IMG_FILTER_GRAYSCALE);
            }
            imagegif($im, $file_temp);
            break;
        case 2:
            imagecopyresampled($im, $oi, $x, $y, 0, 0, $w1, $h1, $w0, $h0);
            if ($sharpen && version_compare(PHP_VERSION, '5.1.0', '>=')) {
                imageconvolution($im, $matrix, $divisor, 0);
            }
            if ($gray) {
                imagefilter($im, IMG_FILTER_GRAYSCALE);
            }
            imagejpeg($im, $file_temp, JPEG_QUALITY);
            break;
        case 3:
            imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
            imagesavealpha($im, true);
            imagealphablending($im, false);
            imagecopyresampled($im, $oi, $x, $y, 0, 0, $w1, $h1, $w0, $h0);
            if ($sharpen && version_compare(PHP_VERSION, '5.1.0', '>=')) {
                $fix = imagecolorat($im, 0, 0);
                imageconvolution($im, $matrix, $divisor, 0);
                imagesetpixel($im, 0, 0, $fix);
            }
            if ($gray) {
                imagefilter($im, IMG_FILTER_GRAYSCALE);
            }
            imagepng($im, $file_temp);
            break;
    }
    imagedestroy($im);
    imagedestroy($oi);
}

header('Content-Type: image/' . $file_type);
header('Content-Length: ' . filesize($file_temp));
header('Content-Disposition: inline; filename="' . $file_name . '"');
header('Last-Modified: ' . $file_date);
header('ETag: ' . $file_hash);
header('Accept-Ranges: none');
if (THUMB_BROWSER_CACHE) {
    header('Cache-Control: max-age=604800, must-revalidate');
    header('Expires: ' . gmdate('D, d M Y H:i:s T', strtotime('+7 days')));
} else {
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Expires: ' . gmdate('D, d M Y H:i:s T'));
    header('Pragma: no-cache');
}

readfile($file_temp);