package main

import (
	"github.com/ethrousseau/weblens/api/dataProcess"
	"github.com/ethrousseau/weblens/api/dataStore"
	"github.com/ethrousseau/weblens/api/routes"
	"github.com/ethrousseau/weblens/api/util"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	sw := util.NewStopwatch("Initialization")
	godotenv.Load()

	if util.IsDevMode() {
		util.Debug.Println("Initializing weblens in development mode")
	} else {
		gin.SetMode(gin.ReleaseMode)
	}

	sw.Lap()
	routes.VerifyClientManager()
	tt := dataProcess.VerifyTaskTracker()
	dataStore.SetTasker(dataProcess.NewWorkQueue())
	sw.Lap("Verify cm, tt and set ds queue")

	dataProcess.SetCaster(routes.Caster)
	dataStore.SetCaster(routes.Caster)
	sw.Lap("Set casters")

	err := dataStore.ClearTempDir()
	util.FailOnError(err, "Failed to clear temporary directory on startup")
	sw.Lap("Clear tmp dir")

	err = dataStore.ClearTakeoutDir()
	util.FailOnError(err, "Failed to clear takeout directory on startup")
	sw.Lap("Clear takeout dir")

	err = dataStore.InitMediaTypeMaps()
	util.FailOnError(err, "Failed to initialize media type map")
	sw.Lap("Init type map")

	// Load filesystem
	dataStore.FsInit()
	sw.Lap("FS init")

	// The global broadcaster is disbled by default so all of the
	// initial loading of the filesystem (that was just done above) doesn't
	// try to broadcast for every file that exists. So it must be enabled here
	routes.Caster.Enable()
	sw.Lap("Global caster enabled")

	// Enable the worker pool heald by the task tracker
	tt.EnableWP()
	sw.Lap("Global worker pool enabled")

	router := gin.Default()

	var ip string

	routes.AddApiRoutes(router)
	if !util.IsDevMode() {
		ip = "0.0.0.0"
		routes.AddUiRoutes(router)
	} else {
		ip = "127.0.0.1"
	}
	sw.Lap("Gin routes added")
	sw.Stop()
	if util.IsDevMode() {
		sw.PrintResults()
	}

	util.Info.Println("Weblens loaded. Starting router...")

	router.Run(ip + ":8080")
}
