package dev.dantecode.plugin

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger

/**
 * Project-level service managing the DanteCode stdio bridge.
 * Lazily starts the bridge on first access and shuts it down
 * when the project closes.
 */
@Service(Service.Level.PROJECT)
class DanteCodeService(private val project: Project) : Disposable {
    private val log = Logger.getInstance(DanteCodeService::class.java)
    private var bridge: StdioBridge? = null

    fun getBridge(): StdioBridge {
        if (bridge == null || !bridge!!.isAlive()) {
            bridge = StdioBridge(project.basePath ?: ".")
            bridge!!.start()
            log.info("DanteCode bridge started for project: ${project.name}")
        }
        return bridge!!
    }

    fun isConnected(): Boolean = bridge?.isAlive() == true

    override fun dispose() {
        bridge?.stop()
        bridge = null
        log.info("DanteCode bridge stopped for project: ${project.name}")
    }

    companion object {
        fun getInstance(project: Project): DanteCodeService =
            project.getService(DanteCodeService::class.java)
    }
}
