using WarOrgan.Data.BuildDataset.Utils;
using WarOrgan.Data.BuildDataset.Validation;
using WarOrgan.Model.DataSet;

var defaultDatasetId = "WH40K11e";
var defaultVersion = Version.TryParse(Environment.GetEnvironmentVariable("DATASET_VERSION"), out var v)
    ? v : new Version(1, 1, 0, 0);
var defaultBuildDirectory = AppContext.BaseDirectory;

var datasetInfo = new DataSetInfo(
    Id: defaultDatasetId,
    Version: defaultVersion,
    DataSetFormatVersion: DataSetInfo.CurrentDataSetFormatVersion,
    PublishDate: DateTime.UtcNow);

// Setup paths
var assetsFolder = Path.Combine(AppContext.BaseDirectory, "Assets", "WH40K11e").EnsureDirectoryExists();
var outputFolder = Path.Combine(AppContext.BaseDirectory, "Output").EnsureDirectoryExists();
var rostersFolder = Path.Combine(assetsFolder, "Rosters").EnsureDirectoryExists();

try
{
    datasetInfo
        .CreateDatasetBuildModel(assetsFolder)
        .AddRosters(rostersFolder)
        .IncludeReadme(assetsFolder)
        .Validate()
        .PublishToZipArchive(outputFolder);
}
catch (Exception ex)
{
    LoggingBuffer.Error($"Dataset build failed: {ex.Message}");
}

LoggingBuffer.Print(waitForInput: false);
return LoggingBuffer.ErrorCount == 0 ? 0 : 1;
