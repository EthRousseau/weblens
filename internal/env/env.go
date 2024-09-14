package env

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"

	"github.com/ethrousseau/weblens/internal/log"
	"github.com/ethrousseau/weblens/internal/werror"
)

func init() {
	log.SetLogLevel(GetLogLevel())
}

var configData map[string]map[string]any
var envLock sync.RWMutex

func ReadConfig(configName string) (map[string]any, error) {
	log.Trace.Println("Reading config", configName)
	envLock.Lock()
	defer envLock.Unlock()
	if configData != nil {
		return configData[configName], nil
	}

	configDir := GetConfigPath()
	configPath := filepath.Join(configDir, "config.json")

	bs, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var config map[string]map[string]any
	err = json.Unmarshal(bs, &config)
	if err != nil {
		return nil, err
	}

	configData = config
	return configData[configName], nil
}

func GetConfigName() string {
	configName := os.Getenv("CONFIG_NAME")
	if configName != "" {
		return configName
	}
	return "PROD"
}

func GetWorkerCount() int {
	config, err := ReadConfig(GetConfigName())
	if err == nil {
		countStr := config["poolWorkerCount"]
		if countStr != nil {
			count, err := strconv.ParseInt(countStr.(string), 10, 64)
			if err == nil {
				return int(count)
			}
		}
	}

	return runtime.NumCPU() - 2
}

var appRoot string

func GetAppRootDir() string {
	if appRoot != "" {
		return appRoot
	}

	appRoot = os.Getenv("APP_ROOT")

	if appRoot == "" {
		appRoot = "/app"
	}

	return appRoot
}

func GetUIPath() string {
	config, err := ReadConfig(GetConfigName())
	if err != nil {
		panic(err)
	}

	uiPath, ok := config["uiPath"].(string)
	if ok {
		return uiPath
	}

	// Default
	return filepath.Join(GetAppRootDir(), "ui/dist")
}

func GetRouterPort(configName ...string) string {
	if len(configName) == 0 {
		configName = append(configName, GetConfigName())
	}
	config, err := ReadConfig(configName[0])
	if err != nil {
		panic(err)
	}

	port, _ := config["routerPort"].(string)
	if port != "" {
		return port
	}

	port = os.Getenv("SERVER_PORT")
	if port == "" {
		log.Info.Println("SERVER_PORT not provided, falling back to 8080")
		return "8080"
	} else {
		return port
	}
}

func GetRouterHost(configName ...string) string {
	if len(configName) == 0 {
		configName = append(configName, GetConfigName())
	}
	config, err := ReadConfig(configName[0])
	if err != nil {
		panic(err)
	}

	host, _ := config["routerHost"].(string)
	if host != "" {
		return host
	}

	host = os.Getenv("ROUTER_HOST")
	if host == "" {
		log.Info.Println("ROUTER_HOST not provided, falling back to localhost")
		return "localhost"
	} else {
		return host
	}
}

func GetLogLevel() int {
	level := os.Getenv("LOG_LEVEL")
	if level == "" {
		config, err := ReadConfig(GetConfigName())
		if err != nil {
			panic(err)
		}

		level, _ = config["logLevel"].(string)
	}

	if level != "" {
		switch level {
		case "debug":
			return log.DEBUG
		case "trace":
			return log.TRACE
		case "quiet":
			return log.QUIET
		}
	}

	return log.DEFAULT
}

// DetachUi Controls if we host UI comm on this server. UI can be hosted elsewhere and
// must proxy any /api/* requests back to this server
func DetachUi() bool {
	config, err := ReadConfig(GetConfigName())
	if err != nil {
		panic(err)
	}

	detach, ok := config["detachUi"].(bool)
	return ok && detach
}

var cachesRoot string

func GetCachesRoot() string {
	if cachesRoot == "" {
		cachesRoot = os.Getenv("CACHES_PATH")
		if cachesRoot == "" {
			config, err := ReadConfig(GetConfigName())
			if err != nil {
				panic(err)
			}
			var ok bool
			cachesRoot, ok = config["cachesRoot"].(string)
			if ok {
				if cachesRoot[0] == '.' {
					cachesRoot, err = filepath.Abs(cachesRoot)
					if err != nil {
						panic(err)
					}
				}
				return cachesRoot
			}
			cachesRoot = "/media/cache"
			log.Warning.Println("Did not find CACHES_PATH, assuming docker default of", cachesRoot)
		}
	}
	return cachesRoot
}

// GetThumbsDir
// Returns the path of the directory for storing cached files. This includes photo thumbnails,
// temp uploaded files, and zip files.
func GetThumbsDir() string {
	cacheString := GetCachesRoot() + "/cache"
	_, err := os.Stat(cacheString)
	if err != nil {
		err = os.MkdirAll(cacheString, 0755)
		if err != nil {
			newErr := werror.Errorf(
				"Caches was found, "+
					"but the cache dir (%s) does not exist and Weblens failed to create it: %s",
				cacheString, err,
			)
			panic(newErr)
		}
	}
	return cacheString
}

func GetTmpDir() string {
	tmpString := GetCachesRoot() + "/tmp"
	_, err := os.Stat(tmpString)
	if err != nil {
		err = os.MkdirAll(tmpString, 0755)
		if err != nil {
			log.ShowErr(err)
			panic("CACHES_PATH provided, but the tmp dir (`CACHES_PATH`/tmp) does not exist and Weblens failed to create it")
		}
	}
	return tmpString
}

func GetMongoURI(configName ...string) string {
	if len(configName) == 0 {
		configName = append(configName, GetConfigName())
	}
	config, err := ReadConfig(configName[0])
	if err != nil {
		panic(err)
	}

	uri, ok := config["mongodbUri"].(string)
	if ok {
		return uri
	}

	return "mongodb://localhost:27017"
}

func GetMongoDBName(configName ...string) string {
	if len(configName) == 0 {
		configName = append(configName, GetConfigName())
	}
	config, err := ReadConfig(configName[0])
	if err != nil {
		panic(err)
	}

	name, ok := config["mongodbName"].(string)
	if ok {
		return name
	}
	return "weblens"
}

func GetHostURL() string {
	config, err := ReadConfig(GetConfigName())
	if err != nil {
		panic(err)
	}

	hostUrl, _ := config["hostUrl"].(string)
	return hostUrl
}

func GetTestMediaPath() string {
	config, err := ReadConfig(GetConfigName())
	if err != nil {
		panic(err)
	}

	testMediaPath, ok := config["testMediaPath"].(string)
	if ok {
		if testMediaPath[0] == '.' {
			testMediaPath = filepath.Join(GetAppRootDir(), testMediaPath)
		}
		return testMediaPath
	}

	testMediaPath = filepath.Join(GetAppRootDir(), "/images/testMedia")
	log.Warning.Printf("TEST_MEDIA_PATH not set, defaulting to %s", testMediaPath)

	return testMediaPath
}

func GetConfigPath() string {
	configPath := os.Getenv("CONFIG_PATH")
	if configPath != "" {
		return configPath
	}
	return filepath.Join(GetAppRootDir(), "config")
}

func ReadTypesConfig(target any) error {
	typeJson, err := os.Open(filepath.Join(GetConfigPath(), "mediaType.json"))
	if err != nil {
		return err
	}
	defer func(typeJson *os.File) {
		err = typeJson.Close()
		if err != nil {
			log.ErrTrace(err)
		}
	}(typeJson)

	typesBytes, err := io.ReadAll(typeJson)
	err = json.Unmarshal(typesBytes, &target)
	if err != nil {
		return err
	}

	return nil
}

func GetCoreApiKey() string {
	return os.Getenv("CORE_API_KEY")
}

func GetMediaRoot(configName ...string) string {
	mediaRoot := os.Getenv("MEDIA_ROOT")
	if mediaRoot != "" {
		return mediaRoot
	}

	if len(configName) == 0 {
		configName = append(configName, GetConfigName())
	}
	config, err := ReadConfig(configName[0])
	if err != nil {
		panic(err)
	}

	mediaRoot = config["mediaRoot"].(string)
	if mediaRoot[0] == '.' {
		mediaRoot = filepath.Join(GetAppRootDir(), mediaRoot)
	}

	if mediaRoot == "" {
		// Container default
		mediaRoot = "/media/users"
	}

	return mediaRoot
}
