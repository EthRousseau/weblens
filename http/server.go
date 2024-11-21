package http

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ethanrous/weblens/docs"
	_ "github.com/ethanrous/weblens/docs" // docs is generated by Swag CLI, you have to import it.
	"github.com/ethanrous/weblens/internal/env"
	"github.com/ethanrous/weblens/internal/log"
	"github.com/ethanrous/weblens/models"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	httpSwagger "github.com/swaggo/http-swagger/v2"
	// gin-swagger middleware
)

type Server struct {
	Running     bool
	StartupFunc func()

	// router     *gin.Engine
	router     *chi.Mux
	stdServer  *http.Server
	routerLock sync.Mutex
	services   *models.ServicePack
	hostStr    string
}

// @title						Weblens API
// @version					1.0
// @description				Programmatic access to the Weblens server
// @license.name				MIT
// @license.url				https://opensource.org/licenses/MIT
// @host						localhost:8080
// @schemes					http https
// @BasePath					/api/
//
// @securityDefinitions.apikey	SessionAuth
// @in							cookie
// @name						weblens-session-token
//
// @securityDefinitions.apikey	ApiKeyAuth
// @in							header
// @name						Authorization
//
// @scope.admin				Grants read and write access to privileged data
func NewServer(host, port string, services *models.ServicePack) *Server {

	proxyHost := env.GetProxyAddress()
	if strings.HasPrefix(proxyHost, "http") {
		i := strings.Index(proxyHost, "://")
		proxyHost = proxyHost[i+3:]
	}
	docs.SwaggerInfo.Host = proxyHost

	srv := &Server{
		router:   chi.NewRouter(),
		services: services,
		hostStr:  host + ":" + port,
	}

	services.Server = srv

	return srv
}

func (s *Server) Start() {
	for {
		if s.services.StartupChan == nil {
			return
		}

		s.router.Mount("/docs", httpSwagger.WrapHandler)
		s.router.Mount("/api", s.UseApi())

		if !env.DetachUi() {
			s.router.Mount("/", s.UseUi())
		}

		go s.StartupFunc()
		<-s.services.StartupChan

		s.routerLock.Lock()
		s.stdServer = &http.Server{Addr: s.hostStr, Handler: s.router}
		s.Running = true

		log.Info.Printf("Starting router at %s", s.hostStr)
		s.routerLock.Unlock()

		err := s.stdServer.ListenAndServe()

		if !errors.Is(err, http.ErrServerClosed) {
			log.Error.Fatalln(err)
		}
		s.routerLock.Lock()
		s.Running = false
		s.stdServer = nil

		// s.router = gin.New()
		s.router = chi.NewRouter()
		s.routerLock.Unlock()
	}
}

func (s *Server) UseApi() *chi.Mux {
	log.Trace.Println("Using api routes")
	r := chi.NewRouter()

	r.Use(log.ApiLogger(log.GetLogLevel()), middleware.Recoverer, CORSMiddleware, WithServices(s.services), WeblensAuth)

	r.Group(func(r chi.Router) {
		r.Use(AllowPublic)
		r.Get("/info", getServerInfo)
		r.Get("/ws", wsConnect)
	})

	// Media
	r.Route("/media", func(r chi.Router) {
		r.Get("/", getMediaBatch)
		r.Post("/{mediaId}/liked", setMediaLiked)
		r.Post("/{mediaId}/file", getMediaFile)
		r.Post("/cleanup", cleanupMedia)
		r.Patch("/visibility", hideMedia)
		r.Patch("/date", adjustMediaDate)

		r.Group(func(r chi.Router) {
			r.Use(AllowPublic)
			r.Get("/types", getMediaTypes)
			r.Get("/{mediaId}/info", getMediaInfo)
			r.Get("/{mediaId}.{extension}", getMediaImage)
			r.Get("/{mediaId}/stream", streamVideo)
			r.Get("/{mediaId}/{chunkName}", streamVideo)
		})
	})

	// Files
	r.Route("/files", func(r chi.Router) {
		r.Get("/{fileId}", getFile)
		r.Get("/{fileId}/text", getFileText)
		r.Get("/{fileId}/stats", getFileStats)
		r.Get("/{fileId}/download", downloadFile)
		r.Get("/{fileId}/history", getFolderHistory)
		r.Get("/search", searchByFilename)
		r.Get("/shared", getSharedFiles)

		r.Post("/restore", restoreFiles)

		r.Patch("/{fileId}", updateFile)
		r.Patch("/", moveFiles)
		// r.Patch("/trash", trashFiles)
		r.Patch("/untrash", unTrashFiles)
		r.Delete("/", deleteFiles)
	})

	// Folder
	r.Route("/folder", func(r chi.Router) {
		r.Post("/", createFolder)
		r.Patch("/{folderId}/cover", setFolderCover)

		r.Group(func(r chi.Router) {
			r.Use(AllowPublic)
			r.Get("/{folderId}", getFolder)
		})
	})

	// Journal
	r.Route("/journal", func(r chi.Router) {
		r.Get("/", getLifetimesSince)
	})

	// Upload
	r.Route("/upload", func(r chi.Router) {
		r.Post("/", newUploadTask)
		r.Post("/{uploadId}", newFileUpload)
		r.Put("/{uploadId}/file/{fileId}", handleUploadChunk)
	})

	// Takeout
	r.Post("/takeout", createTakeout)

	// Users
	r.Route("/users", func(r chi.Router) {
		r.Get("/", getUsers)
		r.Get("/me", getUserInfo)
		r.Get("/search", searchUsers)
		r.Post("/", createUser)

		// Must not use weblens auth here, as the user is not logged in yet
		r.Group(func(r chi.Router) {
			r.Use(AllowPublic)
			r.Post("/auth", loginUser)
		})

		r.Post("/logout", logoutUser)
		r.Patch("/{username}/password", updateUserPassword)
		r.Patch("/{username}/admin", setUserAdmin)
		r.Delete("/", deleteUser)
	})

	// Share
	r.Route("/share", func(r chi.Router) {
		r.Get("/{shareId}", getFileShare)
		r.Post("/file", createFileShare)
		r.Post("/album", createAlbumShare)
		r.Patch("/{shareId}/accessors", setShareAccessors)
		r.Patch("/{shareId}/public", setSharePublic)
		r.Delete("/{shareId}", deleteShare)
	})

	// Albums
	r.Route("/albums", func(r chi.Router) {
		r.Get("/", getAlbums)
		r.Get("/{albumId}", getAlbum)
		r.Get("/{albumId}/media", getAlbumMedia)
		r.Post("/album", createAlbum)
		r.Patch("/{albumId}", updateAlbum)
		r.Delete("/{albumId}", deleteAlbum)
		// r.Get("/{albumId}/preview", albumPreviewMedia)
		// r.Post("/{albumId}/leave", unshareMeAlbum)
	})

	// ApiKeys
	r.Route("/keys", func(r chi.Router) {
		r.Use(RequireAdmin)
		r.Get("/", getApiKeys)
		r.Post("/", newApiKey)
		r.Delete("/{keyId}", deleteApiKey)
	})

	// Servers
	r.Route("/servers", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(AllowPublic)
			r.Post("/init", initializeServer)
		})

		r.Group(func(r chi.Router) {
			r.Use(RequireAdmin)
			r.Get("/", getRemotes)
			r.Post("/", attachRemote)

			r.Get("/backup", doFullBackup)

			r.Post("/{serverId}/backup", launchBackup)
			r.Post("/{serverId}/restore", restoreToCore)
			r.Delete("/{serverId}", removeRemote)

		})
	})

	/* Static content */
	r.Get("/static/{filename}", serveStaticContent)

	return r
}

func (s *Server) UseWebdav(fileService models.FileService, caster models.FileCaster) {
	// fs := service.WebdavFs{
	// 	WeblensFs: fileService,
	// 	Caster:    caster,
	// }

	// handler := &webdav.Handler{
	// 	FileSystem: fs,
	// 	// FileSystem: webdav.Dir(env.GetDataRoot(),
	// 	LockSystem: webdav.NewMemLS(),
	// 	Logger: func(r *http.Request, err error) {
	// 		if err != nil {
	// 			log.Error.Printf("WEBDAV [%s]: %s, ERROR: %s\n", r.Method, r.URL, err)
	// 		} else {
	// 			log.Info.Printf("WEBDAV [%s]: %s \n", r.Method, r.URL)
	// 		}
	// 	},
	// }

	// go http.ListenAndServe(":8081", handler)
}

func (s *Server) UseInterserverRoutes() {
	log.Trace.Println("Using interserver routes")

	// core := s.router.Group("/api/core")
	// core.Use(KeyOnlyAuth(s.services))

	// core.POST("/remote", attachRemote)

	// r.Post("/files", getFilesMeta)
	// r.Get("/file/:fileId", getFileMeta)
	// r.Get("/file/:fileId/stat", getFileStat)
	// r.Get("/file/:fileId/directory", getDirectoryContent)
	// r.Get("/file/content/:contentId", getFileBytes)
	//
	// r.Get("/history/since", getLifetimesSince)
	// r.Get("/history/folder", getFolderHistory)
	//
	// r.Get("/backup", doFullBackup)
}

func (s *Server) UseUi() *chi.Mux {
	memFs := &InMemoryFS{routes: make(map[string]*memFileReal, 10), routesMu: &sync.RWMutex{}, Pack: s.services}
	memFs.loadIndex()

	r := chi.NewMux()
	r.Route("/assets", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "public, max-age=3600")
				w.Header().Set("Content-Encoding", "gzip")
				next.ServeHTTP(w, r)
			})
		})
		r.Handle("/*", http.FileServer(memFs))
	})

	r.NotFound(
		func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.RequestURI, "/api") {
				log.Trace.Func(func(l log.Logger) { l.Printf("Serving index.html for %s", r.RequestURI) })
				// using the real path here makes gin redirect to /, which creates an infinite loop
				// ctx.Writer.Header().Set("Content-Encoding", "gzip")
				_, err := w.Write(memFs.index.data)
				SafeErrorAndExit(err, w)
			} else {
				w.WriteHeader(http.StatusNotFound)
				return
			}
		},
	)

	return r
}

func serveStaticContent(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	fullPath := env.GetAppRootDir() + "/static/" + filename
	f, err := os.Open(fullPath)
	if SafeErrorAndExit(err, w) {
		return
	}

	_, err = io.Copy(w, f)
	SafeErrorAndExit(err, w)
}

func (s *Server) Restart() {
	s.services.Loaded.Store(false)
	s.services.StartupChan = make(chan bool)
	go s.StartupFunc()
	<-s.services.StartupChan
}

func (s *Server) Stop() {
	log.Warning.Println("Stopping server", s.services.InstanceService.GetLocal().GetName())
	s.services.Caster.PushWeblensEvent(models.ServerGoingDownEvent)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := s.stdServer.Shutdown(ctx)
	log.ErrTrace(err)
	log.ErrTrace(ctx.Err())

	for _, c := range s.services.ClientService.GetAllClients() {
		s.services.ClientService.ClientDisconnect(c)
	}
}
